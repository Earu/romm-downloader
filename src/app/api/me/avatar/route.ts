import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/guard";
import { getConfig, normalizeBaseUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Proxy the logged-in user's RomM avatar. RomM serves user assets from
 * `/api/raw/assets/<path>` behind auth, and our RomM base URL is typically an
 * internal host the browser can't reach — so we fetch it server-side with the
 * stored token and stream it back same-origin. Falls back to 404 (the nav then
 * shows the initial) when there's no avatar or RomM can't serve it.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  if (!session.avatarPath) return new NextResponse(null, { status: 404 });

  const cfg = await getConfig();
  if (!cfg.rommUrl || !cfg.rommToken) return new NextResponse(null, { status: 404 });

  try {
    const url = `${normalizeBaseUrl(cfg.rommUrl)}/api/raw/assets/${session.avatarPath}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.rommToken}` },
      cache: "no-store",
    });
    if (!res.ok || !res.body) return new NextResponse(null, { status: 404 });
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        // Private to the user; short cache so a changed avatar refreshes soon.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
