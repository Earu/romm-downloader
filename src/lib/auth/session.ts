import { SignJWT, jwtVerify } from "jose";

// NOTE: no "server-only" — this module is also imported by edge middleware.

export const SESSION_COOKIE = "rd_session";
const MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

// In production AUTH_SECRET is mandatory — the Docker entrypoint auto-generates and
// persists one to /app/data/.auth_secret on first run, so a real deployment always
// has it. We fail closed (throw) if it's somehow missing rather than ever signing
// with a predictable key. For local `npm run dev` only, fall back to a static secret
// so login works out of the box.
const DEV_SECRET = "romm-downloader-insecure-dev-secret-change-me";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (s) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set. Refusing to sign/verify sessions with a predictable key in production.",
    );
  }
  return new TextEncoder().encode(DEV_SECRET);
}

export interface SessionPayload {
  username: string;
  role?: string;
  /** RomM avatar asset path (served via /api/raw/assets); empty when unset. */
  avatarPath?: string;
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    username: payload.username,
    role: payload.role,
    avatarPath: payload.avatarPath,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.username) return null;
    return {
      username: String(payload.username),
      role: payload.role as string | undefined,
      avatarPath: (payload.avatarPath as string | undefined) || undefined,
    };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE_S = MAX_AGE_S;
