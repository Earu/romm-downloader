import { NextResponse } from "next/server";
import { getRommClient } from "@/lib/clients";

export const dynamic = "force-dynamic";

/** GET /api/platforms — RomM platforms for the target-platform selector. */
export async function GET() {
  try {
    const client = await getRommClient();
    const platforms = await client.listPlatforms();
    return NextResponse.json({
      platforms: platforms.map((p) => ({
        id: p.id,
        name: p.custom_name || p.name,
        slug: p.slug,
        fsSlug: p.fs_slug,
        romCount: p.rom_count,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { platforms: [], error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
