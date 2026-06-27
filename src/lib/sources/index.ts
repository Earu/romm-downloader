import "server-only";
import { MinervaNotSyncedError } from "@/lib/minerva/client";
import { minervaSource } from "./minerva";
import {
  type SourceProvider,
  type SourceProviderId,
  type SourceProviderStatus,
  type SourceResult,
  isSourceProviderId,
} from "./types";
import { vimmSource } from "./vimm";

export * from "./types";

/** All registered source providers, in display/result order. Add new ones here. */
const REGISTRY: SourceProvider[] = [minervaSource, vimmSource];

/** Look up a provider by id (used by the orchestrator to resolve a chosen source). */
export function getSourceProvider(id: string): SourceProvider | null {
  return isSourceProviderId(id) ? (REGISTRY.find((p) => p.id === id) ?? null) : null;
}

export interface AggregatedSearch {
  results: SourceResult[];
  providers: SourceProviderStatus[];
}

/**
 * Search every enabled provider concurrently and merge the results. One provider
 * failing (or being unsynced/unsupported for the platform) never blocks the others
 * — each reports its own status and the call never throws.
 */
export async function searchSources(
  query: string,
  opts: {
    platformSlugs?: string[];
    limit?: number;
    includeNonGame?: boolean;
    disabled?: Set<SourceProviderId>;
  } = {},
): Promise<AggregatedSearch> {
  const { platformSlugs = [], limit, includeNonGame, disabled } = opts;

  const settled = await Promise.all(
    REGISTRY.map(async (p): Promise<{ status: SourceProviderStatus; results: SourceResult[] }> => {
      const base = { id: p.id, label: p.label };
      if (disabled?.has(p.id)) return { status: { ...base, status: "disabled" }, results: [] };
      if (!p.supports(platformSlugs)) {
        return { status: { ...base, status: "skipped" }, results: [] };
      }
      try {
        const results = await p.search(query, { platformSlugs, limit, includeNonGame });
        return { status: { ...base, status: "ok" }, results };
      } catch (e) {
        const status = e instanceof MinervaNotSyncedError ? "not-synced" : "error";
        const error = e instanceof Error ? e.message : String(e);
        return { status: { ...base, status, error }, results: [] };
      }
    }),
  );

  // Keep only results on one of the game's official platforms — a free-text
  // provider (Minerva) otherwise surfaces same-named games on other systems.
  const allowed = new Set(platformSlugs);
  const results = settled
    .flatMap((s) => s.results)
    .filter((r) => allowed.size === 0 || (r.platformSlug != null && allowed.has(r.platformSlug)));

  return { results, providers: settled.map((s) => s.status) };
}
