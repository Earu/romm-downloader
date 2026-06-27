import "server-only";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { streamUrlToFile } from "@/lib/jobs/download";
import {
  FIRMWARE_DIR,
  FIRMWARE_MAX_AGE_MS,
  NX_FIRMWARE_ASSET_RE,
  NX_PRODKEYS_API,
  NX_RELEASES_API,
  SWITCH_DIR,
  SWITCH_FW_PATH,
  SWITCH_KEYS_PATH,
  SWITCH_META_PATH,
} from "./constants";
import { crc32Hex } from "./crc32";
import type { FirmwareFile, FirmwareSource, FirmwareSyncStatus } from "./types";

/**
 * Nintendo Switch firmware source (NX_Firmware). Provides the per-version system
 * firmware (uploaded as the release zip) plus the repo's prod.keys — together what
 * Ryujinx/Yuzu need. Sourced to each self-hosted instance from the public repo.
 */
const ID = "switch";
const LABEL = "Switch Firmware";
const UA = "romm-downloader";

interface Meta {
  version?: string;
  fwName?: string; // upload filename (e.g. "Firmware.22.5.0.zip")
  fwCrc32?: string;
  keysCrc32?: string;
  sizeBytes?: number;
  syncedAt?: string;
}

const live = { syncing: false, progress: 0, error: undefined as string | undefined };

async function readMeta(): Promise<Meta> {
  try {
    return JSON.parse(await readFile(SWITCH_META_PATH, "utf8")) as Meta;
  } catch {
    return {};
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  await mkdir(FIRMWARE_DIR, { recursive: true });
  await writeFile(SWITCH_META_PATH, JSON.stringify(meta, null, 2));
}

async function bothExist(): Promise<boolean> {
  try {
    await stat(SWITCH_FW_PATH);
    await stat(SWITCH_KEYS_PATH);
    return true;
  } catch {
    return false;
  }
}

/** Latest firmware release: zip asset URL + name + version (tag). */
async function resolveLatest(): Promise<{ url: string; name: string; version: string }> {
  const res = await fetch(NX_RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`NX_Firmware release lookup failed: HTTP ${res.status}`);
  const rel = (await res.json()) as {
    tag_name?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  const asset = rel.assets?.find((a) => NX_FIRMWARE_ASSET_RE.test(a.name));
  if (!asset) throw new Error("NX_Firmware release has no firmware zip asset");
  return { url: asset.browser_download_url, name: asset.name, version: rel.tag_name ?? "unknown" };
}

/** Fetch the repo's prod.keys (small file → returned base64 by the contents API). */
async function fetchProdKeys(): Promise<Buffer> {
  const res = await fetch(NX_PRODKEYS_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`prod.keys lookup failed: HTTP ${res.status}`);
  const j = (await res.json()) as { content?: string; encoding?: string; download_url?: string };
  if (j.content && j.encoding === "base64") return Buffer.from(j.content, "base64");
  if (j.download_url) {
    const dl = await fetch(j.download_url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!dl.ok) throw new Error(`prod.keys download failed: HTTP ${dl.status}`);
    return Buffer.from(await dl.arrayBuffer());
  }
  throw new Error("prod.keys not retrievable from the repo");
}

async function sync(): Promise<void> {
  if (live.syncing) return;
  live.syncing = true;
  live.error = undefined;
  live.progress = 0;
  try {
    const { url, name, version } = await resolveLatest();
    if ((await bothExist()) && (await readMeta()).version === version) {
      await writeMeta({ ...(await readMeta()), syncedAt: new Date().toISOString() });
      return;
    }

    await mkdir(SWITCH_DIR, { recursive: true });
    const tmp = `${SWITCH_FW_PATH}.part`;
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
    await rm(SWITCH_FW_PATH, { force: true });
    await rename(tmp, SWITCH_FW_PATH);

    const keys = await fetchProdKeys();
    await writeFile(SWITCH_KEYS_PATH, keys);

    const fw = await readFile(SWITCH_FW_PATH);
    await writeMeta({
      version,
      fwName: name,
      fwCrc32: crc32Hex(fw),
      keysCrc32: crc32Hex(keys),
      sizeBytes: bytes,
      syncedAt: new Date().toISOString(),
    });
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
  const ready = await bothExist();
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

export const switchSource: FirmwareSource = {
  id: ID,
  label: LABEL,
  sync,
  async syncIfStale() {
    if (live.syncing) return;
    if ((await getStatus()).stale) await sync();
  },
  isReady: bothExist,
  getStatus,

  async filesForSlug(fsSlug): Promise<FirmwareFile[]> {
    if (fsSlug !== "switch" || !(await bothExist())) return [];
    const meta = await readMeta();
    return [
      {
        name: meta.fwName ?? "Firmware.zip",
        crc32: meta.fwCrc32,
        bytes: () => readFile(SWITCH_FW_PATH),
      },
      { name: "prod.keys", crc32: meta.keysCrc32, bytes: () => readFile(SWITCH_KEYS_PATH) },
    ];
  },
};
