import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { type SourceProviderId, isSourceProviderId, searchSources } from "@/lib/sources";

export const dynamic = "force-dynamic";

/**
 * GET /api/sources/search?q=&platforms=xbox,win&all=1 — search every enabled
 * source provider (Minerva, Vimm, …) for a ROM, scoped/filtered to the game's
 * official platforms (`platforms`, the game's IGDB slugs). Returns merged results
 * plus per-provider status. Always 200: a single provider failing is reported as
 * its own status, never a 5xx.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const platformSlugs = (url.searchParams.get("platforms") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const includeNonGame = url.searchParams.get("all") === "1";
  if (q.trim().length < 3) {
    return NextResponse.json({ results: [], providers: [] });
  }

  const cfg = await getConfig();
  const disabled = new Set(
    cfg.disabledSources.filter(isSourceProviderId) as SourceProviderId[],
  );

  const { results, providers } = await searchSources(q, {
    platformSlugs,
    includeNonGame,
    disabled,
  });
  return NextResponse.json({ results, providers });
}
