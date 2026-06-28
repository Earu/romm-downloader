import "server-only";
import { resolveMagnet, search } from "@/lib/minerva/client";
import type { Acquisition, SourceProvider, SourceResult } from "./types";

/**
 * No-Intro / Redump region names. A parenthetical group counts as the region only
 * when every comma-separated part is one of these, so language groups ("(En,Fr,De)")
 * and qualifiers ("(Rev 1)", "(Proto)") are never mistaken for a region.
 */
const REGION_TOKENS = new Set([
  "usa", "europe", "japan", "world", "asia", "australia", "brazil", "canada",
  "china", "korea", "taiwan", "hong kong", "france", "germany", "italy", "spain",
  "netherlands", "sweden", "norway", "denmark", "finland", "russia", "poland",
  "portugal", "uk", "united kingdom", "greece", "hungary", "ukraine", "israel",
  "new zealand", "south africa", "latin america", "scandinavia", "mexico",
  "argentina", "belgium", "switzerland", "austria", "ireland", "turkey", "unknown",
]);

/**
 * Split the region (the first all-region parenthetical) out of a No-Intro/Redump
 * filename: returns the region normalised to Vimm's lowercase style plus the name
 * with that parenthetical removed (it's shown as a badge instead). Other tags
 * ("(Rev 1)", "(Proto)") are left in place.
 */
function splitRegion(name: string): { name: string; region?: string } {
  for (const m of name.matchAll(/\(([^()]+)\)/g)) {
    const parts = m[1].split(",").map((s) => s.trim().toLowerCase());
    if (parts.length > 0 && parts.every((p) => REGION_TOKENS.has(p))) {
      const at = m.index ?? 0;
      const cleaned = (name.slice(0, at) + name.slice(at + m[0].length))
        .replace(/\s{2,}/g, " ") // collapse the gap the removal left
        .replace(/\s+(\.[a-z0-9]+)$/i, "$1") // drop a space left before the extension
        .trim();
      return { name: cleaned, region: parts.join(", ") };
    }
  }
  return { name };
}

/**
 * Minerva as a source provider. Free-text search over the cached archive index;
 * the platform is inferred per result rather than required up front. Resolves to a
 * torrent (magnet preferred, .torrent URL as the working-tracker fallback).
 */
export const minervaSource: SourceProvider = {
  id: "minerva",
  label: "Minerva",
  transport: "torrent",
  // Free-text over the whole archive; the aggregator drops results that aren't on
  // one of the game's platforms.
  supports: () => true,

  async search(title, { limit, includeNonGame }): Promise<SourceResult[]> {
    // Lets MinervaNotSyncedError propagate so the aggregator can classify it.
    const rows = await search(title, { limit, gamesOnly: !includeNonGame });
    return rows.map((r) => {
      const { name, region } = splitRegion(r.fileName);
      return {
        provider: "minerva",
        transport: "torrent",
        ref: r.fullPath,
        fileName: name,
        platformSlug: r.platformSlug,
        platformName: r.platformName,
        region,
        size: r.size,
      };
    });
  },

  async resolve(ref): Promise<Acquisition> {
    const r = await resolveMagnet(ref);
    const magnetOrHash = r.magnet ?? r.torrentUrl;
    if (!magnetOrHash) throw new Error(`Minerva entry has no magnet or torrent: ${ref}`);
    return {
      kind: "torrent",
      magnetOrHash,
      torrentUrl: r.torrentUrl,
      soId: r.soId,
      fileName: r.fileName,
      size: r.size,
    };
  },
};
