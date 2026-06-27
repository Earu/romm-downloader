import "server-only";
import { PLATFORM_BY_SLUG } from "@/lib/platforms";
import {
  resolveVimmVault,
  searchVimmCandidates,
  vimmSupportsPlatform,
} from "@/lib/vimm/resolver";
import type { Acquisition, SourceProvider, SourceResult } from "./types";

/**
 * Vimm's Lair as a source provider. Search is scoped to a single platform (Vimm's
 * vault is per-system), so it yields nothing without one. Resolves to a direct
 * HTTP download (the real filename/extension comes from the response at fetch time).
 */
export const vimmSource: SourceProvider = {
  id: "vimm",
  label: "Vimm's Lair",
  transport: "http",
  supports: (slugs) => slugs.some(vimmSupportsPlatform),

  async search(title, { platformSlugs }): Promise<SourceResult[]> {
    // Vimm's vault is per-system: search each of the game's platforms it covers
    // and tag every result with that platform.
    const supported = platformSlugs.filter(vimmSupportsPlatform);
    const perPlatform = await Promise.all(
      supported.map(async (platformSlug): Promise<SourceResult[]> => {
        const cands = await searchVimmCandidates(title, platformSlug);
        const platformName = PLATFORM_BY_SLUG.get(platformSlug)?.name;
        return cands.map((c) => ({
          provider: "vimm",
          transport: "http",
          ref: c.vaultId,
          fileName: c.title,
          platformSlug,
          platformName,
          region: c.region,
          version: c.version,
          extras: c.extras,
        }));
      }),
    );
    return perPlatform.flat();
  },

  async resolve(ref): Promise<Acquisition> {
    const r = await resolveVimmVault(ref);
    if (!r) throw new Error(`Couldn't resolve that Vimm's Lair download: ${ref}`);
    return { kind: "http", url: r.url, headers: r.headers, fileName: r.fileName };
  },
};
