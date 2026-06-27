import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Lifecycle states for a download job. The worker advances jobs through these
 * in order; `done` and `failed` are terminal. See lib/jobs/orchestrator.ts.
 */
export const JOB_STATES = [
  "requested", // created, not yet picked up
  "resolving", // looking up the chosen ROM's magnet in the Minerva index
  "adding", // add magnet to the debrid provider
  "caching", // debrid provider downloading/caching to its cloud
  "fetching", // streaming the file from the debrid provider to local tmp
  "unavailable", // debrid provider can't serve this file — awaiting user's fallback choice
  "multi_file", // torrent has several files but no shared library to group them — awaiting user's choice
  "local_fetching", // downloading the file via the built-in torrent client (&so)
  "http_fetching", // downloading the file directly over HTTP from a source URL (e.g. Vimm's Lair)
  "uploading", // chunked upload into RomM + scan
  "done",
  "failed",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const downloadJobs = sqliteTable("download_jobs", {
  id: text("id").primaryKey(), // uuid
  // Catalog/metadata identity (IGDB)
  catalogGameId: text("catalog_game_id"),
  title: text("title").notNull(),
  coverUrl: text("cover_url"),
  // Chosen ROM file path within the Minerva index (the acquisition target).
  minervaPath: text("minerva_path"),
  // RomM target
  targetPlatformId: integer("target_platform_id").notNull(),
  targetPlatformSlug: text("target_platform_slug").notNull(),
  // Debrid acquisition
  releaseName: text("release_name"),
  magnetOrHash: text("magnet_or_hash"),
  minervaSoId: integer("minerva_so_id"), // BitTorrent file index from Minerva hashes.db
  debridProvider: text("debrid_provider"), // which debrid service handled this job
  debridId: text("debrid_id"), // provider transfer id
  debridFileId: text("debrid_file_id"), // chosen file id within the transfer
  // Chosen source (provider-agnostic): which catalog the ROM came from and its
  // provider-specific reference (Minerva path / Vimm vault id / pasted magnet).
  sourceProvider: text("source_provider"), // "minerva" | "vimm" | "magnet"
  sourceRef: text("source_ref"),
  // Direct HTTP source (e.g. Vimm's Lair) — streamed locally as-is.
  sourceUrl: text("source_url"),
  // Progress / status
  state: text("state").$type<JobState>().notNull().default("requested"),
  progress: integer("progress").notNull().default(0), // 0..100
  bytesTotal: integer("bytes_total"),
  bytesDownloaded: integer("bytes_downloaded"),
  uploadedFilename: text("uploaded_filename"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type DownloadJob = typeof downloadJobs.$inferSelect;
export type NewDownloadJob = typeof downloadJobs.$inferInsert;

/**
 * Torrents whose swarm was found dead (no seeders/peers) by the built-in client.
 * Keyed by a stable swarm identity (info hash / torrent URL / Minerva path) so a
 * later attempt on the same torrent warns immediately instead of waiting out the
 * client's stall timeout. See lib/jobs/dead-torrents.ts.
 */
export const deadTorrents = sqliteTable("dead_torrents", {
  id: text("id").primaryKey(), // "btih:<hash>" / "src:<url>" / "minerva:<path>"
  title: text("title"),
  reason: text("reason").notNull(),
  detectedAt: integer("detected_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type DeadTorrent = typeof deadTorrents.$inferSelect;

/**
 * Single-row table (id=1) holding runtime-overridable settings. Env vars are the
 * default/fallback; values here take precedence when set (Settings page writes here).
 */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  rommUrl: text("romm_url"),
  rommToken: text("romm_token"),
  debridProvider: text("debrid_provider"),
  debridApiKey: text("debrid_api_key"),
  maxDebridGb: integer("max_debrid_gb"),
  igdbClientId: text("igdb_client_id"),
  igdbClientSecret: text("igdb_client_secret"),
  downloadTmpDir: text("download_tmp_dir"),
  // CSV of source-provider ids the user has turned off; null/"" = all enabled.
  disabledSources: text("disabled_sources"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Settings = typeof settings.$inferSelect;
