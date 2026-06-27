import "server-only";

/**
 * Where a ROM is found. `minerva` and `vimm` are searchable catalogs; `magnet` is
 * a pseudo-provider for a user-pasted magnet (not searchable, but a valid source
 * recorded on the job so the resolve step treats it uniformly).
 */
export type SourceProviderId = "minerva" | "vimm" | "magnet";

/** The searchable providers, shown as toggles in Settings. */
export const SOURCE_PROVIDERS: { id: SourceProviderId; label: string }[] = [
  { id: "minerva", label: "Minerva" },
  { id: "vimm", label: "Vimm's Lair" },
];

export function isSourceProviderId(v: string): v is SourceProviderId {
  return v === "minerva" || v === "vimm" || v === "magnet";
}

/** How a chosen source is acquired — drives the orchestrator dispatch + the UI badge. */
export type Transport = "torrent" | "http";

/** One search hit from a source provider. */
export interface SourceResult {
  provider: SourceProviderId;
  transport: Transport;
  /** Opaque, provider-specific id resolved to a download later
   *  (Minerva: full archive path; Vimm: vault id). */
  ref: string;
  fileName: string;
  /** Inferred/known platform, so the UI can badge + auto-select it. */
  platformSlug?: string;
  platformName?: string;
  // Display qualifiers (best-effort, provider-dependent).
  region?: string;
  version?: string;
  extras?: string[];
  size?: number;
}

/**
 * A resolved, ready-to-download source, discriminated by acquisition kind. The
 * orchestrator maps `torrent` onto the magnet/debrid pipeline and `http` onto the
 * direct-stream pipeline.
 */
export type Acquisition =
  | {
      kind: "torrent";
      magnetOrHash: string;
      torrentUrl?: string;
      soId?: number;
      fileName: string;
      size?: number;
    }
  | {
      kind: "http";
      url: string;
      headers?: Record<string, string>;
      fileName: string;
      size?: number;
    };

export interface SourceSearchOptions {
  /** The platforms the game officially exists on (IGDB slugs). Per-platform
   *  providers (e.g. Vimm) search each supported one; free-text providers
   *  (Minerva) ignore it for matching. Results outside this set are dropped. */
  platformSlugs: string[];
  limit?: number;
  /** Include non-game content (docs/software/music/BIOS). Honoured by Minerva;
   *  irrelevant providers ignore it. */
  includeNonGame?: boolean;
}

/**
 * A catalog the app can search for a ROM and resolve to a download. Implemented
 * per provider as a thin adapter over the existing client; registered in index.ts.
 */
export interface SourceProvider {
  readonly id: SourceProviderId;
  readonly label: string;
  /** Fixed acquisition kind for everything this provider yields. */
  readonly transport: Transport;
  /** Whether this provider can contribute for any of the game's platforms. */
  supports(platformSlugs: string[]): boolean;
  search(title: string, opts: SourceSearchOptions): Promise<SourceResult[]>;
  resolve(ref: string): Promise<Acquisition>;
}

/** Per-provider outcome of an aggregated search, for surfacing in the UI. */
export interface SourceProviderStatus {
  id: SourceProviderId;
  label: string;
  status: "ok" | "error" | "not-synced" | "disabled" | "skipped";
  error?: string;
}
