import { SignJWT, jwtVerify } from "jose";

// NOTE: no "server-only" — this module is also imported by edge middleware.

export const SESSION_COOKIE = "rd_session";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

// Dev fallback so login works out of the box; set AUTH_SECRET in production.
const DEV_SECRET = "romm-downloader-insecure-dev-secret-change-me";
let warned = false;

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s && !warned) {
    warned = true;
    console.warn("[auth] AUTH_SECRET not set — using an insecure dev secret. Set AUTH_SECRET in production.");
  }
  return new TextEncoder().encode(s || DEV_SECRET);
}

export interface SessionPayload {
  username: string;
  role?: string;
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ username: payload.username, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.username) return null;
    return { username: String(payload.username), role: payload.role as string | undefined };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE_S = MAX_AGE_S;
