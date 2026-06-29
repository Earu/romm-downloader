import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/auth/session";
import { getPinnedRommUrl, normalizeBaseUrl } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { clientIp, rateLimit } from "@/lib/http/rate-limit";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  rommProvisionToken,
  rommTokenCanFirmware,
  rommTokenValid,
  rommValidateLogin,
} from "@/lib/romm/auth";

export const dynamic = "force-dynamic";

// Brute-force / credential-stuffing guard on this public endpoint.
const LOGIN_LIMIT = 10; // attempts
const LOGIN_WINDOW_MS = 60_000; // per minute, per client IP

const schema = z.object({
  rommUrl: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Resolve the RomM URL to actually connect to. To prevent an unauthenticated
 * SSRF (this endpoint is public), we IGNORE the client-supplied URL whenever the
 * server already has one configured — via a saved settings row or the ROMM_URL
 * env var. Only on a truly fresh install (neither configured) do we accept the
 * URL from the login form, and then only if it parses as an http(s) URL.
 *
 * Note: we deliberately do NOT block private/LAN addresses — a self-hosted RomM
 * normally lives on a private or Docker-internal host, which is exactly why
 * pinning (not IP filtering) is the right control here.
 */
async function resolveRommBase(clientUrl: string): Promise<string | null> {
  const pinned = await getPinnedRommUrl();
  if (pinned) return pinned;
  try {
    const u = new URL(clientUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return normalizeBaseUrl(clientUrl);
  } catch {
    return null;
  }
}

/** Log in with RomM credentials: validate, provision a token, start a session. */
export async function POST(req: Request) {
  const rl = rateLimit(`login:${clientIp(req)}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing url, username or password" }, { status: 400 });
  }
  const { username, password } = parsed.data;
  const base = await resolveRommBase(parsed.data.rommUrl);
  if (!base) {
    return NextResponse.json({ error: "RomM server URL is not configured" }, { status: 400 });
  }

  let user;
  try {
    user = await rommValidateLogin(base, username, password);
  } catch {
    return NextResponse.json({ error: `Couldn't reach RomM at ${base}` }, { status: 502 });
  }
  if (!user) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  // Reuse the stored token if it's still valid; otherwise provision a fresh one.
  // The stored token is encrypted-at-rest, so decrypt before using it as a bearer.
  const existing = await db.select().from(settings).where(eq(settings.id, 1)).get();
  let token =
    existing?.rommUrl === base && existing?.rommToken
      ? decryptSecret(existing.rommToken)
      : null;
  if (token && !(await rommTokenValid(base, token))) token = null;
  // Re-provision tokens issued before firmware scopes were added, so firmware
  // uploads don't 403 on an otherwise-valid older token.
  if (token && !(await rommTokenCanFirmware(base, token))) token = null;
  if (!token) {
    try {
      token = await rommProvisionToken(base, username, password);
    } catch (e) {
      // Log the detail server-side; don't echo upstream error bodies to clients.
      console.error("[auth] RomM token provisioning failed:", e);
      return NextResponse.json(
        { error: "Couldn't set up the RomM connection. Check the server logs." },
        { status: 502 },
      );
    }
  }

  // Persist the RomM connection (used by the app + background worker). The token
  // is encrypted-at-rest; getConfig decrypts it for consumers.
  const values = {
    id: 1 as const,
    rommUrl: base,
    rommToken: encryptSecret(token),
    updatedAt: new Date(),
  };
  await db.insert(settings).values(values).onConflictDoUpdate({ target: settings.id, set: values });

  const jwt = await createSession({
    username: user.username,
    role: user.role,
    avatarPath: user.avatarPath,
  });
  // Only mark the cookie Secure when the request is actually HTTPS — many
  // self-hosted setups serve plain HTTP, where a Secure cookie wouldn't be sent.
  const isHttps =
    req.headers.get("x-forwarded-proto") === "https" ||
    new URL(req.url).protocol === "https:";
  const res = NextResponse.json({ username: user.username, role: user.role });
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
    secure: isHttps,
  });
  return res;
}
