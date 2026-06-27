import "server-only";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { streamUrlToFile } from "@/lib/jobs/download";
import {
  FIRMWARE_DIR,
  FIRMWARE_MAX_AGE_MS,
  PS3_META_PATH,
  PS3_PUP_PATH,
  PS3_UPDATELIST_URL,
} from "./constants";
import { crc32Hex } from "./crc32";
import type { FirmwareFile, FirmwareSource, FirmwareSyncStatus } from "./types";

/**
 * PS3 system software source. The PS3 (RPCS3) needs Sony's official firmware
 * (PS3UPDAT.PUP) — not a small redistributable BIOS, so it isn't in the RetroBIOS
 * pack. We fetch the current PUP straight from Sony's update CDN and upload it to
 * RomM's `bios/ps3/` folder.
 */
const ID = "ps3";
const LABEL = "PS3 System Software";
const UA = "Mozilla/5.0"; // some Sony CDN edges reject an empty/default UA

interface Meta {
  version?: string;
  crc32?: string;
  sizeBytes?: number;
  syncedAt?: string;
}

const live = { syncing: false, progress: 0, error: undefined as string | undefined };

async function readMeta(): Promise<Meta> {
  try {
    return JSON.parse(await readFile(PS3_META_PATH, "utf8")) as Meta;
  } catch {
    return {};
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  await mkdir(FIRMWARE_DIR, { recursive: true });
  await writeFile(PS3_META_PATH, JSON.stringify(meta, null, 2));
}

async function pupExists(): Promise<boolean> {
  try {
    await stat(PS3_PUP_PATH);
    return true;
  } catch {
    return false;
  }
}

/** Read Sony's update list for the current full-updater PUP URL + version. */
async function resolveLatest(): Promise<{ url: string; version: string }> {
  const res = await fetch(PS3_UPDATELIST_URL, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PS3 update list failed: HTTP ${res.status}`);
  const txt = await res.text();
  // The full updater line: "...;SystemSoftwareVersion=4.9300;CDN=http://...PS3UPDAT.PUP;..."
  const urlM = /(https?:\/\/\S+?PS3UPDAT\.PUP)/i.exec(txt);
  if (!urlM) throw new Error("No PS3UPDAT.PUP URL in Sony's update list");
  const verM = /SystemSoftwareVersion=([0-9.]+)/i.exec(txt);
  return { url: urlM[1], version: verM ? verM[1] : "unknown" };
}

async function sync(): Promise<void> {
  if (live.syncing) return;
  live.syncing = true;
  live.error = undefined;
  live.progress = 0;
  try {
    const { url, version } = await resolveLatest();
    if ((await pupExists()) && (await readMeta()).version === version) {
      await writeMeta({ ...(await readMeta()), syncedAt: new Date().toISOString() });
      return;
    }

    const tmp = `${PS3_PUP_PATH}.part`;
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
    await rm(PS3_PUP_PATH, { force: true });
    await rename(tmp, PS3_PUP_PATH);
    const data = await readFile(PS3_PUP_PATH);
    await writeMeta({ version, crc32: crc32Hex(data), sizeBytes: bytes, syncedAt: new Date().toISOString() });
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
  const ready = await pupExists();
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

export const ps3Source: FirmwareSource = {
  id: ID,
  label: LABEL,
  sync,
  async syncIfStale() {
    if (live.syncing) return;
    if ((await getStatus()).stale) await sync();
  },
  isReady: pupExists,
  getStatus,

  async filesForSlug(fsSlug): Promise<FirmwareFile[]> {
    if (fsSlug !== "ps3" || !(await pupExists())) return [];
    const meta = await readMeta();
    return [{ name: "PS3UPDAT.PUP", crc32: meta.crc32, bytes: () => readFile(PS3_PUP_PATH) }];
  },
};
