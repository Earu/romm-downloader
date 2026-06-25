import "server-only";

export type DebridProviderId = "torbox" | "realdebrid" | "alldebrid" | "premiumize";

export const DEBRID_PROVIDERS: { id: DebridProviderId; label: string }[] = [
  { id: "torbox", label: "TorBox" },
  { id: "realdebrid", label: "Real-Debrid" },
  { id: "alldebrid", label: "AllDebrid" },
  { id: "premiumize", label: "Premiumize" },
];

export function isDebridProviderId(v: string): v is DebridProviderId {
  return DEBRID_PROVIDERS.some((p) => p.id === v);
}

/** A file inside a debrid transfer. */
export interface DebridFile {
  /** Provider-specific file identifier. */
  id: string;
  name: string;
  size: number;
  /** Provider per-file link, when the provider exposes one (RD/AllDebrid). */
  link?: string;
}

/** Status of a debrid transfer. */
export interface DebridStatus {
  /** The transfer's files are downloaded and ready to pull. */
  ready: boolean;
  /** 0..1 download progress (best-effort). */
  progress: number;
  files: DebridFile[];
}

/** What the caller is trying to acquire — lets providers that require upfront
 * file selection (e.g. Real-Debrid) pick the right file. */
export interface AcquireHint {
  releaseName: string | null;
  soId: number | null;
}

/**
 * A debrid/seedbox service that can take a magnet, fetch it to its cloud, and
 * hand back a direct download URL. Implemented per provider; selected at runtime.
 */
export interface DebridProvider {
  readonly id: DebridProviderId;
  readonly label: string;
  /** Verify the API key authenticates. Throws on failure. */
  ping(): Promise<void>;
  /** Add a magnet (or info-hash); returns the provider's transfer id. */
  addMagnet(magnetOrHash: string, hint: AcquireHint): Promise<string>;
  /** Current status + files; null if the transfer isn't visible yet. */
  getStatus(id: string, hint: AcquireHint): Promise<DebridStatus | null>;
  /** Direct, streamable URL for a file within the transfer. */
  getDownloadLink(id: string, file: DebridFile): Promise<string>;
  /** Best-effort removal of the transfer from the provider's cloud. */
  remove(id: string): Promise<void>;
}

export class DebridError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DebridError";
  }
}

/** Extract the 40-hex / 32-base32 BitTorrent info hash from a magnet, if present. */
export function infoHashFromMagnet(input: string): string | null {
  const m = /btih:([0-9a-fA-F]{40}|[0-9a-zA-Z]{32})/.exec(input);
  return m ? m[1].toLowerCase() : null;
}
