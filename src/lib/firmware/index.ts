import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppConfig, getConfig } from "@/lib/config";
import { toRommFsSlug } from "@/lib/platforms";
import { type RommFirmware, type RommPlatform, RommClient } from "@/lib/romm/client";
import { FIRMWARE_DIR } from "./constants";
import { ps3Source } from "./ps3";
import { retrobiosSource } from "./retrobios";
import type {
  FirmwareFile,
  FirmwareInstallSummary,
  FirmwarePlatformState,
  FirmwarePlatformStatus,
  FirmwareSource,
} from "./types";

export * from "./types";

/** Registered firmware sources, in priority order. Add new ones (e.g. Switch) here. */
const REGISTRY: FirmwareSource[] = [retrobiosSource, ps3Source];

const SUMMARY_PATH = join(FIRMWARE_DIR, "install-summary.json");
// Upload files in size-bounded batches so a big set (e.g. ~70 PS2 BIOS) doesn't
// buffer hundreds of MB or exceed RomM's request size limits.
const BATCH_BYTES = 32 * 1024 * 1024;

let running = false;

/**
 * Pack folders use RomM's canonical platform slugs (e.g. `ngc`, `psx`, `dc`). A
 * RomM platform may instead carry the IGDB-style slug (`gc`, `ps`, `dreamcast`),
 * so try both the platform's fs_slug and its canonical form.
 */
function candidateSlugs(fsSlug: string): string[] {
  const canonical = toRommFsSlug(fsSlug);
  return canonical === fsSlug ? [fsSlug] : [fsSlug, canonical];
}

async function packFilesFor(source: FirmwareSource, fsSlug: string): Promise<FirmwareFile[]> {
  for (const slug of candidateSlugs(fsSlug)) {
    const files = await source.filesForSlug(slug);
    if (files.length > 0) return files;
  }
  return [];
}

// Platforms that need firmware/keys we can't source from a pack (console-unique
// or non-redistributable: Switch/Wii U keys, PS3 PUP, 3DS/Vita keys). For these,
// "no files present" is a real problem (KO), not "firmware not needed".
const NEEDS_EXTERNAL_FIRMWARE = new Set([
  "switch", "wiiu", "wii-u", "ps3", "psvita", "vita", "3ds", "n3ds",
]);

function needsExternalFirmware(fsSlug: string): boolean {
  return candidateSlugs(fsSlug).some((s) => NEEDS_EXTERNAL_FIRMWARE.has(s));
}

/** A present RomM file is trustworthy if RomM verified it, or its CRC matches ours. */
function fileGood(rf: RommFirmware, pf: FirmwareFile): boolean {
  if (rf.is_verified) return true;
  return !!(rf.crc_hash && pf.crc32 && rf.crc_hash.toLowerCase() === pf.crc32.toLowerCase());
}

const STATE_ORDER: Record<FirmwarePlatformState, number> = { ko: 0, unknown: 1, ok: 2 };

/**
 * Keep only the platforms RomM itself surfaces: recognised (RomM resolved a logo;
 * a bad/untranslated fs_slug yields a bare logo-less "Gc"/"Ps"), holding at least
 * one ROM (RomM hides empty platforms — so firmware follows your games), deduped
 * by fs_slug (most ROMs wins).
 */
function realPlatforms(platforms: RommPlatform[]): RommPlatform[] {
  const bySlug = new Map<string, RommPlatform>();
  for (const p of platforms) {
    if (!p.url_logo) continue; // RomM couldn't match it → not a real platform
    if ((p.rom_count ?? 0) === 0) continue; // RomM hides platforms with no ROMs
    const existing = bySlug.get(p.fs_slug);
    if (!existing || (p.rom_count ?? 0) > (existing.rom_count ?? 0)) bySlug.set(p.fs_slug, p);
  }
  return [...bySlug.values()];
}

async function readSummary(): Promise<FirmwareInstallSummary | undefined> {
  try {
    return JSON.parse(await readFile(SUMMARY_PATH, "utf8")) as FirmwareInstallSummary;
  } catch {
    return undefined;
  }
}

async function writeSummary(summary: FirmwareInstallSummary): Promise<void> {
  await writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2)).catch(() => {});
}

/** Pack sync status for each source, the last install summary, and whether a pass
 *  is currently running (for the UI's "working" feedback). */
export async function getFirmwareStatus() {
  const sources = await Promise.all(REGISTRY.map((s) => s.getStatus()));
  return { sources, summary: await readSummary(), installing: running };
}

/**
 * For every RomM platform, upload any BIOS files the registered sources have that
 * RomM is missing. Idempotent (skips files already present by name). Records a
 * per-platform summary for the Settings UI.
 */
export async function installMissingFirmware(cfg: AppConfig): Promise<FirmwareInstallSummary> {
  const romm = new RommClient({ baseUrl: cfg.rommUrl, token: cfg.rommToken });
  const platforms = realPlatforms(await romm.listPlatforms());
  let error: string | undefined;

  // Sync the sources' packs up front; work only with the ones that are ready.
  const ready: FirmwareSource[] = [];
  for (const source of REGISTRY) {
    await source.syncIfStale().catch((e) => {
      error = e instanceof Error ? e.message : String(e);
    });
    if (await source.isReady()) ready.push(source);
  }

  const results: FirmwarePlatformStatus[] = [];
  for (const p of platforms) {
    const name = p.custom_name || p.name;

    // Union of the files all ready sources have for this platform (deduped by name).
    const packFiles: FirmwareFile[] = [];
    for (const source of ready) {
      for (const f of await packFilesFor(source, p.fs_slug)) {
        if (!packFiles.some((x) => x.name === f.name)) packFiles.push(f);
      }
    }

    // No source covers this platform → OK unless it needs firmware we can't get.
    if (packFiles.length === 0) {
      const needs = needsExternalFirmware(p.fs_slug);
      results.push({ slug: p.fs_slug, name, state: needs ? "ko" : "ok", present: 0, total: 0, needsFirmware: needs });
      continue;
    }

    let current = await romm.listFirmware(p.id);
    const missing = packFiles.filter((f) => !current.some((c) => c.file_name === f.name));
    if (missing.length > 0) {
      try {
        let batch: { name: string; data: Uint8Array }[] = [];
        let batchBytes = 0;
        const flush = async () => {
          if (batch.length === 0) return;
          await romm.uploadFirmware(p.id, batch);
          batch = [];
          batchBytes = 0;
        };
        for (const f of missing) {
          const data = await f.bytes();
          if (batchBytes + data.length > BATCH_BYTES && batch.length > 0) await flush();
          batch.push({ name: f.name, data });
          batchBytes += data.length;
        }
        await flush();
        current = await romm.listFirmware(p.id);
      } catch (e) {
        // A 403 here means the token lacks firmware.write — surface it clearly.
        error = e instanceof Error ? e.message : String(e);
      }
    }

    const presentFiles = packFiles.filter((f) => current.some((c) => c.file_name === f.name));
    let state: FirmwarePlatformState;
    if (presentFiles.length < packFiles.length) {
      state = "ko"; // some required files couldn't be installed
    } else {
      const allTrusted = packFiles.every((f) => {
        const rf = current.find((c) => c.file_name === f.name)!;
        return fileGood(rf, f);
      });
      state = allTrusted ? "ok" : "unknown";
    }
    results.push({
      slug: p.fs_slug,
      name,
      state,
      present: presentFiles.length,
      total: packFiles.length,
      needsFirmware: true,
    });
  }

  // Surface problems first (KO, then UNKNOWN, then OK), stable by name within a state.
  results.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));

  const summary: FirmwareInstallSummary = { ranAt: new Date().toISOString(), platforms: results, error };
  await writeSummary(summary);
  return summary;
}

/**
 * One firmware pass: sync the sources' packs and install anything missing.
 * Guarded so overlapping runs don't stack. The automatic (worker) caller respects
 * the auto-install setting; a manual trigger passes `force` to run regardless.
 * Safe to call on boot and on an interval (cheap when nothing's missing).
 */
export async function runFirmwarePass(force = false): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cfg = await getConfig();
    if (!force && !cfg.firmwareAutoInstall) return;
    if (!cfg.rommUrl || !cfg.rommToken) return; // not logged in yet
    await installMissingFirmware(cfg);
  } catch (e) {
    console.error("[firmware] pass error:", e);
  } finally {
    running = false;
  }
}
