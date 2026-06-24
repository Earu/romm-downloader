import { NextResponse } from "next/server";
import { getCatalogProvider } from "@/lib/catalog";
import { hasSupportedPlatform } from "@/lib/minerva/platform";

export const dynamic = "force-dynamic";

/** GET /api/catalog?q=zelda — search the catalog (empty q = popular). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const provider = await getCatalogProvider();
  if (!provider.isEnabled()) {
    return NextResponse.json(
      { enabled: false, games: [], error: "Catalog metadata (IGDB) not configured" },
      { status: 200 },
    );
  }
  try {
    // Only surface games available on a platform we can actually acquire for.
    const games = (await provider.search(q)).filter((g) =>
      hasSupportedPlatform(g.platforms),
    );
    return NextResponse.json({ enabled: true, games });
  } catch (e) {
    return NextResponse.json(
      { enabled: true, games: [], error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
