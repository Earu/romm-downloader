import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, type SessionPayload, verifySession } from "@/lib/auth/session";

// Kept in its own module (not session.ts) so `next/headers` is never pulled into
// the edge-middleware bundle, which imports session.ts.

/** Read and verify the current session from the request cookie, or null. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

/** RomM's admin role. Matched case-insensitively to tolerate "ADMIN" vs "admin". */
export function isAdmin(session: SessionPayload | null): boolean {
  return session?.role?.toLowerCase() === "admin";
}

/**
 * Guard for admin-only route handlers. Returns the session when the caller is an
 * admin, or a ready-to-return 401/403 `NextResponse` otherwise. Usage:
 *
 *   const gate = await requireAdmin();
 *   if (gate instanceof NextResponse) return gate;
 *   // ...gate is the admin session
 */
export async function requireAdmin(): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}
