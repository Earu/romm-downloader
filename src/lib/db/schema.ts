import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Lifecycle states for a download job. The worker advances jobs through these
 * in order; `done` and `failed` are terminal. See lib/jobs/orchestrator.ts.
 */
export const JOB_STATES = [
  "requested", // created, not yet picked up
  "resolving", // looking up the chosen ROM's magnet in the Minerva index
  "adding", // POST createtorrent (TorBox)
  "caching", // TorBox downloading/caching to its cloud
  "fetching", // streaming the file from TorBox to local tmp
  "unavailable", // TorBox can't serve this file — awaiting user's fallback choice
  "local_fetching", // downloading the file via the built-in torrent client (&so)
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
  // TorBox acquisition
  releaseName: text("release_name"),
  magnetOrHash: text("magnet_or_hash"),
  minervaSoId: integer("minerva_so_id"), // BitTorrent file index from Minerva hashes.db
  torboxId: integer("torbox_id"),
  torboxFileId: integer("torbox_file_id"),
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
 * Single-row table (id=1) holding runtime-overridable settings. Env vars are the
 * default/fallback; values here take precedence when set (Settings page writes here).
 */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  rommUrl: text("romm_url"),
  rommToken: text("romm_token"),
  torboxApiKey: text("torbox_api_key"),
  igdbClientId: text("igdb_client_id"),
  igdbClientSecret: text("igdb_client_secret"),
  downloadTmpDir: text("download_tmp_dir"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Settings = typeof settings.$inferSelect;
