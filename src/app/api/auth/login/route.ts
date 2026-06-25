import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/auth/session";
import { normalizeBaseUrl } from "@/lib/config";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { rommProvisionToken, rommTokenValid, rommValidateLogin } from "@/lib/romm/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  rommUrl: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

/** Log in with RomM credentials: validate, provision a token, start a session. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing url, username or password" }, { status: 400 });
  }
  const { username, password } = parsed.data;
  const base = normalizeBaseUrl(parsed.data.rommUrl);

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
  const existing = await db.select().from(settings).where(eq(settings.id, 1)).get();
  let token =
    existing?.rommUrl === base && existing?.rommToken ? existing.rommToken : null;
  if (token && !(await rommTokenValid(base, token))) token = null;
  if (!token) {
    try {
      token = await rommProvisionToken(base, username, password);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  }

  // Persist the RomM connection (used by the app + background worker).
  const values = { id: 1 as const, rommUrl: base, rommToken: token, updatedAt: new Date() };
  await db.insert(settings).values(values).onConflictDoUpdate({ target: settings.id, set: values });

  const jwt = await createSession({ username: user.username, role: user.role });
  // Only mark the cookie Secure when the request is actually HTTPS — many
  // self-hosted setups serve plain HTTP, where a Secure cookie wouldn't be sent.
  const isHttps =
    req.headers.get("x-forwarded-proto") === "https" ||
    new URL(req.url).protocol === "https:";
  const res = NextResponse.json({ username: user.username, role: user.role });
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
    secure: isHttps,
  });
  return res;
}
