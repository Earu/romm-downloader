import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Current session (for the nav/account UI). This is a "whoami" probe, not a
 * protected resource, so a missing/invalid session is a normal 200 result
 * (`authenticated: false`) rather than a 401 — avoids noisy console errors on the
 * login screen and during the logout/login flow.
 */
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) return NextResponse.json({ authenticated: false });
  return NextResponse.json({ authenticated: true, ...session });
}
