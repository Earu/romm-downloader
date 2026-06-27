import "server-only";

/** One firmware/BIOS file a source can provide, with lazy access to its bytes. */
export interface FirmwareFile {
  name: string;
  /** CRC32 (8 hex chars) from the source, to confirm a present file matches ours. */
  crc32?: string;
  bytes(): Promise<Buffer>;
}

/** Sync/availability status of a firmware source (drives the Settings UI). */
export interface FirmwareSyncStatus {
  id: string;
  label: string;
  /** A download/cache is in progress. */
  syncing: boolean;
  /** 0..100 while downloading. */
  progress?: number;
  /** The source's data is cached and usable. */
  ready: boolean;
  /** Upstream version (release tag) of the cached data. */
  version?: string;
  sizeBytes?: number;
  syncedAt?: string; // ISO
  /** Cache is missing or older than the max age. */
  stale: boolean;
  error?: string;
}

/**
 * A provider of emulator BIOS/firmware files, keyed to RomM platforms by fs_slug.
 * Implemented per source (RetroBIOS now; a Switch-keys source later) and registered
 * in index.ts. Mirrors the `src/lib/sources` provider pattern.
 */
export interface FirmwareSource {
  readonly id: string;
  readonly label: string;
  /** Ensure the source's data is cached if missing/stale (no-op when fresh). */
  syncIfStale(): Promise<void>;
  /** Force a (re)sync now. */
  sync(): Promise<void>;
  isReady(): Promise<boolean>;
  getStatus(): Promise<FirmwareSyncStatus>;
  /** The firmware files this source has for a RomM platform (by fs_slug). */
  filesForSlug(fsSlug: string): Promise<FirmwareFile[]>;
}

/**
 * Per-platform firmware health:
 * - `ok`: all needed files present and either RomM-verified or an exact match to
 *   our source files; OR the platform needs no firmware.
 * - `unknown`: all files present but unverifiable and not matching our copies.
 * - `ko`: required firmware is missing (covered-but-incomplete, or a platform that
 *   needs firmware we can't source).
 */
export type FirmwarePlatformState = "ok" | "unknown" | "ko";

export interface FirmwarePlatformStatus {
  slug: string;
  name: string;
  state: FirmwarePlatformState;
  present: number; // files present in RomM
  total: number; // files our sources provide (0 = no coverage)
  /** When uncovered (total 0): whether this platform needs firmware to run. */
  needsFirmware: boolean;
}

/** Per-platform outcome of an install pass, surfaced in the UI. */
export interface FirmwareInstallSummary {
  ranAt: string; // ISO
  platforms: FirmwarePlatformStatus[];
  error?: string;
}
