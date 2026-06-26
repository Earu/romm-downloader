import "server-only";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { streamUrlToFile } from "@/lib/jobs/download";
import {
  MINERVA_DB_PATH,
  MINERVA_DB_URL,
  MINERVA_DIR,
  MINERVA_INDEX_PATH,
  MINERVA_INDEX_URL,
  MINERVA_MAX_AGE_MS,
  MINERVA_META_PATH,
} from "./constants";

export interface MinervaSyncMeta {
  indexSyncedAt?: string; // ISO
  dbSyncedAt?: string; // ISO
  dbBytes?: number;
}

export interface MinervaSyncStatus extends MinervaSyncMeta {
  syncing: boolean;
  phase?: "index" | "db";
  progress?: number; // 0..100 for the db phase
  error?: string;
  stale: boolean;
}

// In-memory progress for the currently running sync (one at a time).
const live = {
  syncing: false,
  phase: undefined as "index" | "db" | undefined,
  progress: 0,
  error: undefined as string | undefined,
};

async function readMeta(): Promise<MinervaSyncMeta> {
  try {
    return JSON.parse(await readFile(MINERVA_META_PATH, "utf8")) as MinervaSyncMeta;
  } catch {
    return {};
  }
}

async function writeMeta(meta: MinervaSyncMeta): Promise<void> {
  await mkdir(MINERVA_DIR, { recursive: true });
  await writeFile(MINERVA_META_PATH, JSON.stringify(meta, null, 2));
}

export async function getSyncStatus(): Promise<MinervaSyncStatus> {
  const meta = await readMeta();
  const newest = meta.dbSyncedAt ?? meta.indexSyncedAt;
  const stale = !newest || Date.now() - new Date(newest).getTime() > MINERVA_MAX_AGE_MS;
  return {
    ...meta,
    syncing: live.syncing,
    phase: live.phase,
    progress: live.progress,
    error: live.error,
    stale,
  };
}

export async function isSynced(): Promise<boolean> {
  try {
    await stat(MINERVA_DB_PATH);
    await stat(MINERVA_INDEX_PATH);
    return true;
  } catch {
    return false;
  }
}

/** Download + decompress the search index (small, ~25MB). */
async function syncIndex(): Promise<void> {
  live.phase = "index";
  const res = await fetch(MINERVA_INDEX_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`index download failed: HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const text = gunzipSync(gz);
  await mkdir(MINERVA_DIR, { recursive: true });
  await writeFile(MINERVA_INDEX_PATH, text);
}

/** Download the ~1.76GB hashes.db to a temp file, then atomically swap in. */
async function syncDb(): Promise<number> {
  live.phase = "db";
  live.progress = 0;
  const tmp = `${MINERVA_DB_PATH}.part`;
  // Clean up any leftover temp file from a previous failed attempt.
  await rm(tmp, { force: true });
  let bytes: number;
  try {
    ({ bytes } = await streamUrlToFile(MINERVA_DB_URL, tmp, (d, t) => {
      live.progress = t ? Math.round((d / t) * 100) : 0;
    }));
  } catch (e) {
    // Download failed — clean up the partial temp file; keep existing db intact.
    await rm(tmp, { force: true });
    throw e;
  }
  // Download is complete. Now atomically replace the live db.
  // On Windows, fs.rename fails with EEXIST if destination exists — delete first.
  await rm(MINERVA_DB_PATH, { force: true });
  await rename(tmp, MINERVA_DB_PATH);
  return bytes;
}

/**
 * Run a full sync (index + db). Guarded so only one runs at a time. Updates the
 * persisted meta on success. Returns immediately if a sync is already running.
 */
export async function runSync(): Promise<MinervaSyncStatus> {
  if (live.syncing) return getSyncStatus();
  live.syncing = true;
  live.error = undefined;
  const meta = await readMeta();
  try {
    await syncIndex();
    meta.indexSyncedAt = new Date().toISOString();
    await writeMeta(meta);

    const bytes = await syncDb();
    meta.dbSyncedAt = new Date().toISOString();
    meta.dbBytes = bytes;
    await writeMeta(meta);

    // Invalidate the in-memory search index so it reloads fresh.
    invalidateIndexCache?.();
  } catch (e) {
    live.error = e instanceof Error ? e.message : String(e);
  } finally {
    live.syncing = false;
    live.phase = undefined;
  }
  return getSyncStatus();
}

/** Trigger a sync only if data is missing or older than ~1 month. */
export async function syncIfStale(): Promise<void> {
  if (live.syncing) return;
  const status = await getSyncStatus();
  if (!(await isSynced()) || status.stale) {
    void runSync();
  }
}

// Set by client.ts to clear its cached index after a re-sync.
let invalidateIndexCache: (() => void) | undefined;
export function registerIndexInvalidator(fn: () => void): void {
  invalidateIndexCache = fn;
}
