import "server-only";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import unzipper from "unzipper";
import { streamUrlToFile } from "@/lib/jobs/download";
import {
  FIRMWARE_DIR,
  FIRMWARE_MAX_AGE_MS,
  RETROBIOS_ASSET_RE,
  RETROBIOS_META_PATH,
  RETROBIOS_PACK_PATH,
  RETROBIOS_RELEASES_API,
} from "./constants";
import type { FirmwareFile, FirmwareSource, FirmwareSyncStatus } from "./types";

interface Meta {
  version?: string; // release tag of the cached pack
  sizeBytes?: number;
  syncedAt?: string; // ISO
}

const ID = "retrobios";
const LABEL = "RetroBIOS";

// In-memory progress for the running sync (one at a time).
const live = { syncing: false, progress: 0, error: undefined as string | undefined };

async function readMeta(): Promise<Meta> {
  try {
    return JSON.parse(await readFile(RETROBIOS_META_PATH, "utf8")) as Meta;
  } catch {
    return {};
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  await mkdir(FIRMWARE_DIR, { recursive: true });
  await writeFile(RETROBIOS_META_PATH, JSON.stringify(meta, null, 2));
}

async function packExists(): Promise<boolean> {
  try {
    await stat(RETROBIOS_PACK_PATH);
    return true;
  } catch {
    return false;
  }
}

// api.github.com rejects requests without a User-Agent (403); send one everywhere.
const UA = "romm-downloader";

/** Resolve the latest RomM-platform pack asset (download URL + release tag). */
async function resolveLatestAsset(): Promise<{ url: string; tag: string }> {
  const res = await fetch(RETROBIOS_RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RetroBIOS release lookup failed: HTTP ${res.status}`);
  const rel = (await res.json()) as {
    tag_name?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  const asset = rel.assets?.find((a) => RETROBIOS_ASSET_RE.test(a.name));
  if (!asset) throw new Error("RetroBIOS release has no RomM platform BIOS pack asset");
  return { url: asset.browser_download_url, tag: rel.tag_name ?? "unknown" };
}

async function sync(): Promise<void> {
  if (live.syncing) return;
  live.syncing = true;
  live.error = undefined;
  live.progress = 0;
  try {
    const { url, tag } = await resolveLatestAsset();

    // Skip the (large) download when the cached pack is already this release.
    if ((await packExists()) && (await readMeta()).version === tag) {
      await writeMeta({ ...(await readMeta()), syncedAt: new Date().toISOString() });
      return;
    }

    const tmp = `${RETROBIOS_PACK_PATH}.part`;
    await mkdir(FIRMWARE_DIR, { recursive: true });
    await rm(tmp, { force: true });
    let bytes: number;
    try {
      ({ bytes } = await streamUrlToFile(
        url,
        tmp,
        (d, t) => {
          live.progress = t ? Math.round((d / t) * 100) : 0;
        },
        { "User-Agent": UA },
      ));
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    // Atomic swap (delete-first for Windows EEXIST).
    await rm(RETROBIOS_PACK_PATH, { force: true });
    await rename(tmp, RETROBIOS_PACK_PATH);
    await writeMeta({ version: tag, sizeBytes: bytes, syncedAt: new Date().toISOString() });
  } catch (e) {
    live.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    live.syncing = false;
    live.progress = 0;
  }
}

async function getStatus(): Promise<FirmwareSyncStatus> {
  const meta = await readMeta();
  const ready = await packExists();
  const stale =
    !ready || !meta.syncedAt || Date.now() - new Date(meta.syncedAt).getTime() > FIRMWARE_MAX_AGE_MS;
  return {
    id: ID,
    label: LABEL,
    syncing: live.syncing,
    progress: live.syncing ? live.progress : undefined,
    ready,
    version: meta.version,
    sizeBytes: meta.sizeBytes,
    syncedAt: meta.syncedAt,
    stale,
    error: live.error,
  };
}

export const retrobiosSource: FirmwareSource = {
  id: ID,
  label: LABEL,
  sync,
  async syncIfStale() {
    if (live.syncing) return;
    if ((await getStatus()).stale) await sync();
  },
  isReady: packExists,
  getStatus,

  async filesForSlug(fsSlug): Promise<FirmwareFile[]> {
    if (!fsSlug || !(await packExists())) return [];
    const prefix = `bios/${fsSlug}/`;
    const dir = await unzipper.Open.file(RETROBIOS_PACK_PATH);
    return dir.files
      .filter((f) => f.type === "File" && f.path.startsWith(prefix))
      .map((f) => {
        // The zip central directory carries each entry's CRC32 — surface it (hex)
        // so the installer can confirm a present RomM file matches ours.
        const crc = (f as { crc32?: number }).crc32;
        return {
          name: basename(f.path),
          crc32: crc != null ? (crc >>> 0).toString(16).padStart(8, "0") : undefined,
          bytes: () => f.buffer(),
        };
      });
  },
};
