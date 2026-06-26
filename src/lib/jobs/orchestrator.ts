import "server-only";
import { execFile, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import unzipper from "unzipper";

const execFileP = promisify(execFile);
// 7-Zip CLI (alpine `p7zip` provides `7z`); handles both .zip and .7z. Overridable.
const SEVENZIP = process.env.SEVENZIP_PATH || "7z";

/**
 * Run a 7z extraction (args[0] is the command, e.g. "x"/"e"), reporting progress
 * (0..100) by polling the output directory's size against `totalBytes` (the
 * archive's uncompressed size). Extracting a multi-GB image takes minutes and
 * drives the "Installing" bar — but 7-Zip suppresses its own percentage when
 * stdout isn't a TTY, so we estimate from disk instead.
 */
function extractWithProgress(
  args: string[],
  progressDir: string,
  totalBytes: number,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(SEVENZIP, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errTail = "";
    proc.stderr?.on("data", (d: Buffer) => {
      errTail = (errTail + d.toString()).slice(-300);
    });
    const timer =
      onProgress && totalBytes > 0
        ? setInterval(() => {
            execFileP("du", ["-sk", progressDir])
              .then(({ stdout }) => {
                const kb = parseInt(stdout, 10);
                if (!Number.isNaN(kb)) {
                  onProgress(Math.min(99, Math.round(((kb * 1024) / totalBytes) * 100)));
                }
              })
              .catch(() => {});
          }, 1500)
        : null;
    const finish = (err?: Error) => {
      if (timer) clearInterval(timer);
      if (err) reject(err);
      else resolve();
    };
    proc.on("error", finish);
    proc.on("close", (code) =>
      finish(code === 0 ? undefined : new Error(`7z exited ${code}: ${errTail.trim()}`)),
    );
  });
}
import { type AppConfig, getConfig } from "@/lib/config";
import {
  type AcquireHint,
  type DebridFile,
  type DebridProvider,
  getDebridProvider,
} from "@/lib/debrid";
import type { DownloadJob } from "@/lib/db/schema";
import { resolveMagnet } from "@/lib/minerva/client";
import { toRommFsSlug } from "@/lib/platforms";
import { RommClient } from "@/lib/romm/client";
import {
  type VimmCandidate,
  resolveVimmVault,
  searchVimmCandidates,
  vimmHeaders,
  vimmSupportsPlatform,
} from "@/lib/vimm/resolver";
import { streamUrlToFile } from "./download";
import { getDeadTorrent, recordDeadTorrent, torrentIdentity } from "./dead-torrents";
import { countJobsByDebridId, createDebridFetchJob, failJob, updateJob } from "./queue";
import { downloadSelectedFile, TorrentDeadError } from "./torrent";

/** Advance a single job by one step. Long steps (fetch/upload) run to completion. */
export async function advanceJob(job: DownloadJob): Promise<void> {
  const cfg = await getConfig();
  try {
    switch (job.state) {
      case "requested":
        return await handleResolve(job, !!getDebridProvider(cfg));
      case "adding":
        return await handleAdd(job, requireProvider(cfg));
      case "caching":
        return await handleCaching(job, requireProvider(cfg), cfg.maxDebridGb, cfg.rommLibraryPath);
      case "fetching":
        return await handleFetching(job, requireProvider(cfg), cfg.downloadTmpDir);
      case "local_fetching":
        return await handleLocalFetching(job, cfg.downloadTmpDir);
      case "http_fetching":
        return await handleHttpFetching(job, cfg.downloadTmpDir);
      case "uploading":
        return await handleUploading(
          job,
          new RommClient({ baseUrl: cfg.rommUrl, token: cfg.rommToken }),
          cfg.downloadTmpDir,
          cfg.rommLibraryPath,
        );
      default:
        return; // terminal or unknown — nothing to do
    }
  } catch (e) {
    await failJob(job.id, e instanceof Error ? e.message : String(e));
    // Remove any partially-downloaded / leftover files for this failed job.
    await rm(join(cfg.downloadTmpDir, job.id), { recursive: true, force: true }).catch(
      () => {},
    );
  }
}

/** Delete the local tmp directory holding a job's downloaded/extracted files. */
export async function cleanupJobFiles(jobId: string): Promise<void> {
  const cfg = await getConfig();
  await rm(join(cfg.downloadTmpDir, jobId), { recursive: true, force: true }).catch(() => {});
}

/** The candidate game files for a parked multi_file job (for the picker modal). */
export async function listJobFiles(
  job: DownloadJob,
): Promise<{ id: string; name: string; size: number }[]> {
  const cfg = await getConfig();
  const provider = getDebridProvider(cfg);
  if (!provider || !job.debridId) return [];
  const status = await provider.getStatus(job.debridId, hintOf(job));
  if (!status) return [];
  const files = status.files.filter((f) => !basename(f.name).startsWith("."));
  return gameFilesOf(files)
    .filter((f) => f.size <= cfg.maxDebridGb * 1024 ** 3)
    .map((f) => ({ id: f.id, name: basename(f.name), size: f.size }));
}

/**
 * Resolve a parked multi_file job to a single chosen file and send it on to the
 * fetch step. Returns false if the file id isn't valid for the transfer.
 */
export async function pickJobFile(job: DownloadJob, fileId: string): Promise<boolean> {
  const cfg = await getConfig();
  const provider = getDebridProvider(cfg);
  if (!provider || !job.debridId) return false;
  const status = await provider.getStatus(job.debridId, hintOf(job));
  const file = status?.files.find((f) => f.id === fileId);
  if (!file) return false;
  await updateJob(job.id, {
    state: "fetching",
    debridFileId: file.id,
    bytesTotal: file.size,
    uploadedFilename: basename(file.name),
    progress: 0,
    error: null,
  });
  return true;
}

/** Candidate Vimm's Lair versions for a job's game (for the chooser modal). */
export async function listVimmCandidates(job: DownloadJob): Promise<VimmCandidate[]> {
  if (!vimmSupportsPlatform(job.targetPlatformSlug)) return [];
  return searchVimmCandidates(job.releaseName || job.title, job.targetPlatformSlug);
}

/**
 * Fallback: download a chosen Vimm's Lair file (`vaultId`) directly over HTTP.
 * Used when the torrent is dead or the debrid provider can't serve it. The job's
 * title/filename become the Vimm name. Returns false (parking the job in
 * "unavailable") when the vault can't be resolved.
 */
export async function startVimmFallback(job: DownloadJob, vaultId: string): Promise<boolean> {
  const resolved = await resolveVimmVault(vaultId);
  if (!resolved) {
    await updateJob(job.id, {
      state: "unavailable",
      error: `Couldn't resolve that Vimm's Lair download.`,
    });
    return false;
  }
  await updateJob(job.id, {
    state: "http_fetching",
    // Show the Vimm filename in the UI (it replaces the original torrent name).
    title: resolved.fileName,
    sourceUrl: resolved.url,
    uploadedFilename: resolved.fileName,
    releaseName: resolved.fileName, // keep equal so it's not treated as a collection archive
    bytesTotal: null,
    bytesDownloaded: null,
    progress: 0,
    error: null,
  });
  return true;
}

function requireProvider(cfg: AppConfig): DebridProvider {
  const provider = getDebridProvider(cfg);
  if (!provider) throw new Error("No debrid provider configured");
  return provider;
}

function hintOf(job: DownloadJob): AcquireHint {
  return { releaseName: job.releaseName, soId: job.minervaSoId };
}

// Non-payload extensions to skip when picking a manual torrent's main file.
const IGNORE_EXT = new Set([
  ".txt", ".nfo", ".sfv", ".md", ".url", ".diz", ".jpg", ".jpeg", ".png", ".gif",
]);

function extOf(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/** Game (payload) files in a manual-magnet torrent: not an obvious non-ROM extra. */
function gameFilesOf(files: DebridFile[]): DebridFile[] {
  const candidates = files.filter((f) => !IGNORE_EXT.has(extOf(f.name)));
  return (candidates.length > 0 ? candidates : files).slice().sort((a, b) => b.size - a.size);
}

// Disc-based systems whose standalone emulators (PPSSPP, PCSX2, Dolphin, etc.)
// can't boot a zipped disc image — they need the raw .iso/.cso/.bin/etc. Myrient
// packs the image in a .zip, so for these we extract it before handing to RomM.
// (Cartridge systems run on libretro cores that read .zip fine, so leave those.)
const DISC_PLATFORMS = new Set([
  "psp", "ps2", "ps3", "ps", "psvita",
  "gc", "wii", "wiiu", "3ds",
  "xbox", "xbox360",
  "saturn", "dreamcast", "sega-cd", "turbografx-cd", "neo-geo-cd", "pc-fx", "3do", "cdi",
]);

/** Content files inside a .zip/.7z (skipping scans/nfo/dirs) + total uncompressed
 *  bytes (for extraction-progress estimation), via 7z. */
async function listArchiveEntries(
  archivePath: string,
): Promise<{ files: string[]; bytes: number }> {
  const { stdout } = await execFileP(SEVENZIP, ["l", "-slt", "-ba", archivePath], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const files: string[] = [];
  let bytes = 0;
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const pathM = /^Path = (.+)$/m.exec(block);
    const attrM = /^Attributes = (.*)$/m.exec(block);
    if (!pathM || !attrM) continue; // skip the archive-info block (no Attributes)
    if (/D/.test(attrM[1])) continue; // directory
    const path = pathM[1].trim();
    if (IGNORE_EXT.has(extOf(basename(path)))) continue;
    files.push(path);
    const sizeM = /^Size = (\d+)$/m.exec(block);
    if (sizeM) bytes += Number(sizeM[1]);
  }
  return { files, bytes };
}

/** Extract a single inner file from a .zip/.7z to destDir (flat), via 7z. */
async function extractArchiveFile(
  archivePath: string,
  innerPath: string,
  destDir: string,
  totalBytes = 0,
  onProgress?: (pct: number) => void,
): Promise<string | null> {
  await mkdir(destDir, { recursive: true });
  try {
    await extractWithProgress(
      ["e", "-y", `-o${destDir}`, archivePath, innerPath],
      destDir,
      totalBytes,
      onProgress,
    );
    const out = join(destDir, basename(innerPath));
    return existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

async function handleResolve(job: DownloadJob, hasDebrid: boolean): Promise<void> {
  // With no debrid provider configured, go straight to the built-in torrent
  // client (aria2); otherwise add to the debrid service first.
  const next = hasDebrid ? "adding" : "local_fetching";

  // A user-supplied magnet (no Minerva path) needs no resolution. The exact
  // file/size are unknown here — they're determined from the torrent during
  // caching/fetching (largest-file pick).
  if (!job.minervaPath) {
    if (!job.magnetOrHash) {
      await failJob(job.id, "No Minerva path or magnet on job");
      return;
    }
    await updateJob(job.id, { state: next, progress: 0 });
    return;
  }

  await updateJob(job.id, { state: "resolving" });
  const resolved = await resolveMagnet(job.minervaPath);
  const acquire = resolved.magnet ?? resolved.torrentUrl;
  if (!acquire) {
    await failJob(job.id, "Minerva entry has no magnet or torrent");
    return;
  }
  await updateJob(job.id, {
    state: next,
    releaseName: resolved.fileName,
    magnetOrHash: acquire,
    bytesTotal: resolved.size ?? null,
    uploadedFilename: resolved.fileName,
    minervaSoId: resolved.soId ?? null,
  });
}

async function handleAdd(job: DownloadJob, provider: DebridProvider): Promise<void> {
  if (!job.magnetOrHash) {
    await failJob(job.id, "No magnet/hash on job");
    return;
  }
  const id = await provider.addMagnet(job.magnetOrHash, hintOf(job));
  await updateJob(job.id, {
    state: "caching",
    debridProvider: provider.id,
    debridId: id,
    progress: 0,
  });
}

async function handleCaching(
  job: DownloadJob,
  provider: DebridProvider,
  maxDebridGb: number,
  rommLibraryPath: string,
): Promise<void> {
  if (!job.debridId) {
    await failJob(job.id, "No debrid transfer id on job");
    return;
  }
  const status = await provider.getStatus(job.debridId, hintOf(job));
  if (!status) return; // not visible yet; try again next tick

  if (!status.ready) {
    await updateJob(job.id, { progress: Math.round((status.progress ?? 0) * 100) });
    return;
  }

  const files = status.files.filter((f) => !basename(f.name).startsWith("."));
  const maxBytes = maxDebridGb * 1024 ** 3;

  // Manual magnet (no Minerva release name): there's no single file to match.
  if (!job.releaseName) {
    const gameFiles = gameFilesOf(files).filter((f) => f.size <= maxBytes);
    if (gameFiles.length === 0) {
      const tooBig = files.some((f) => f.size > maxBytes);
      await updateJob(job.id, {
        state: "unavailable",
        error: tooBig
          ? `Every file in this torrent is over the ${maxDebridGb} GB ${provider.label} limit. ` +
            `Raise the limit in Settings or use the built-in torrent client.`
          : `${provider.label} has no game files cached for this torrent yet.`,
      });
      return;
    }

    // A single file uploads as one ROM regardless of how it's delivered.
    if (gameFiles.length === 1) {
      const only = gameFiles[0];
      await updateJob(job.id, {
        state: "fetching",
        debridFileId: only.id,
        bytesTotal: only.size,
        uploadedFilename: basename(only.name),
        progress: 0,
      });
      return;
    }

    // Several files (base game + updates + DLC). RomM can only show them as ONE
    // library entry if they share a per-game folder, which needs this app to
    // share RomM's library on disk. With that available, fan out a job per file
    // (all grouped into one folder on upload). Without it, park the job so the
    // user can pick a single file or configure ROMM_LIBRARY_PATH.
    if (await isLibraryWritable(rommLibraryPath)) {
      const [first, ...rest] = gameFiles;
      for (const f of rest) {
        await createDebridFetchJob(job, f.id, basename(f.name), f.size);
      }
      await updateJob(job.id, {
        state: "fetching",
        debridFileId: first.id,
        bytesTotal: first.size,
        uploadedFilename: basename(first.name),
        progress: 0,
      });
    } else {
      await updateJob(job.id, {
        state: "multi_file",
        error:
          `This download has ${gameFiles.length} files (e.g. base game + updates + DLC). ` +
          `RomM can't store them as one game over the network. Pick a single file to add, ` +
          `or set ROMM_LIBRARY_PATH so they're grouped into one library entry.`,
      });
    }
    return;
  }

  // Minerva packs an entire platform set into ONE torrent and the file we want
  // is identified by name. A debrid service exposes whatever files it has for
  // the transfer, so the file may or may not be available. Pick deliberately:
  //   1. exact file present  -> the right individual ROM (use directly)
  //   2. whole-set archive    -> a single Minerva_Myrient.zip to extract from
  //   3. neither              -> the provider doesn't have our ROM: hand off to
  //      the user, never upload some other game that happens to be present.
  const wanted = basename(job.releaseName).toLowerCase();
  let file = files.find((f) => basename(f.name).toLowerCase() === wanted);
  if (!file) {
    file = files.find((f) => {
      const b = basename(f.name).toLowerCase();
      return b.startsWith("minerva_myrient") && b.endsWith(".zip");
    });
  }

  if (!file) {
    // The provider can't serve this file. Park the job in "unavailable" so the
    // user can fetch just this file via the built-in torrent client.
    const available = files.map((f) => basename(f.name)).slice(0, 4).join(", ");
    await updateJob(job.id, {
      state: "unavailable",
      error:
        `${provider.label} doesn't have "${job.releaseName}" for this bundle torrent` +
        (available ? ` (it only has: ${available})` : "") +
        `.`,
    });
    return;
  }

  // Don't pull very large files through the debrid provider (e.g. a whole-set
  // mega-archive or a big disc image) — hand off to the user instead.
  if (file.size > maxBytes) {
    const gb = (file.size / 1024 ** 3).toFixed(1);
    await updateJob(job.id, {
      state: "unavailable",
      error:
        `This download is ${gb} GB, over the ${maxDebridGb} GB ${provider.label} limit. ` +
        `Use the built-in torrent client or copy the magnet to download it yourself.`,
    });
    return;
  }

  await updateJob(job.id, {
    state: "fetching",
    debridFileId: file.id,
    bytesTotal: file.size,
    // The downloaded filename; when it's a whole-set archive it differs from
    // releaseName and handleUploading extracts the requested ROM from it.
    uploadedFilename: basename(file.name),
    progress: 0,
  });
}

/**
 * Fallback download path: fetch the requested file with the built-in torrent
 * client (aria2 `--select-file`), then hand off to upload. Used for the built-in
 * client on an "unavailable" job, for the no-debrid path, and for manual magnets.
 */
async function handleLocalFetching(job: DownloadJob, tmpDir: string): Promise<void> {
  if (!job.minervaPath && !job.magnetOrHash) {
    await failJob(job.id, "No Minerva path or magnet for local torrent download");
    return;
  }

  // If this swarm was already found dead, don't sit through the stall timeout
  // again — park the job straight away with the recorded warning.
  const identity = torrentIdentity(job);
  if (identity) {
    const dead = await getDeadTorrent(identity);
    if (dead) {
      await updateJob(job.id, { state: "unavailable", error: dead.reason });
      return;
    }
  }

  const jobDir = join(tmpDir, job.id);
  await mkdir(jobDir, { recursive: true });

  // For Minerva entries, prefer the actual .torrent file — it carries Minerva's
  // full, working tracker list. For a manual magnet, use the magnet as-is.
  let source: string | Buffer | undefined;
  if (job.minervaPath) {
    const resolved = await resolveMagnet(job.minervaPath);
    if (resolved.torrentUrl) {
      const res = await fetch(resolved.torrentUrl, { cache: "no-store" });
      if (res.ok) source = Buffer.from(await res.arrayBuffer());
    }
    source = source ?? resolved.magnet ?? job.magnetOrHash ?? undefined;
  } else {
    source = job.magnetOrHash ?? undefined;
  }
  if (!source) {
    await failJob(job.id, "No torrent or magnet available for local download");
    return;
  }

  let lastWrite = 0;
  let result;
  try {
    result = await downloadSelectedFile(
      source,
      job.minervaSoId,
      job.releaseName,
      jobDir,
      (downloaded, total) => {
        const now = Date.now();
        if (now - lastWrite >= 1000) {
          lastWrite = now;
          const pct = total ? Math.round((downloaded / total) * 100) : 0;
          void updateJob(job.id, { progress: pct, bytesDownloaded: downloaded, bytesTotal: total });
        }
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A confirmed-dead swarm (no peers ever) is permanent — remember it so the
    // next attempt warns immediately instead of waiting out the stall timeout.
    if (e instanceof TorrentDeadError && identity) {
      await recordDeadTorrent(identity, job.title, msg);
    }
    // A dead torrent isn't a dead end — park the job so the user can fall back to
    // Vimm's Lair (a reliable direct download) or grab the magnet to do it manually.
    await updateJob(job.id, { state: "unavailable", error: msg });
    return;
  }

  // The client writes into nested torrent folders; flatten to jobDir/<name> so
  // handleUploading finds it.
  const finalPath = join(jobDir, result.name);
  if (result.path !== finalPath) {
    await rename(result.path, finalPath).catch(async () => {
      await copyFile(result.path, finalPath);
    });
  }

  await updateJob(job.id, {
    state: "uploading",
    uploadedFilename: result.name,
    bytesDownloaded: result.bytes,
    bytesTotal: result.bytes,
    progress: 0,
  });
}

async function handleFetching(
  job: DownloadJob,
  provider: DebridProvider,
  tmpDir: string,
): Promise<void> {
  if (!job.debridId || !job.debridFileId || !job.uploadedFilename) {
    await failJob(job.id, "Missing debrid file info");
    return;
  }
  // Re-read the transfer so we have the file (and its per-file link, for
  // providers that need one) before requesting the direct URL.
  const status = await provider.getStatus(job.debridId, hintOf(job));
  const file = status?.files.find((f) => f.id === job.debridFileId);
  if (!file) {
    await failJob(job.id, "Debrid file is no longer available");
    return;
  }
  const url = await provider.getDownloadLink(job.debridId, file);
  const dest = join(tmpDir, job.id, job.uploadedFilename);

  // Persist progress on a ~1s cadence (not per-5%) so the Downloads page can
  // derive a live network speed / ETA from successive byte readings.
  let lastWrite = 0;
  const { bytes } = await streamUrlToFile(url, dest, (downloaded, total) => {
    const now = Date.now();
    if (now - lastWrite >= 1000) {
      lastWrite = now;
      const pct = total ? Math.round((downloaded / total) * 100) : 0;
      void updateJob(job.id, { progress: pct, bytesDownloaded: downloaded });
    }
  });
  await updateJob(job.id, { state: "uploading", bytesDownloaded: bytes, progress: 0 });
}

/**
 * Download a file directly over HTTP from `job.sourceUrl` (e.g. a Vimm's Lair
 * fallback) into the tmp dir, then hand off to upload. Reuses the generic
 * streamer; Vimm needs a browser UA + Referer. The real filename/extension
 * (Vimm serves disc games as `.7z`) comes from the response, not the resolver.
 */
async function handleHttpFetching(job: DownloadJob, tmpDir: string): Promise<void> {
  if (!job.sourceUrl) {
    await failJob(job.id, "Missing source URL for HTTP download");
    return;
  }
  const jobDir = join(tmpDir, job.id);
  await mkdir(jobDir, { recursive: true });
  const tmpPath = join(jobDir, ".download.part");
  const headers = job.sourceUrl.includes("vimm.net") ? vimmHeaders() : undefined;

  let lastWrite = 0;
  const { bytes, filename } = await streamUrlToFile(
    job.sourceUrl,
    tmpPath,
    (downloaded, total) => {
      const now = Date.now();
      if (now - lastWrite >= 1000) {
        lastWrite = now;
        const pct = total ? Math.round((downloaded / total) * 100) : 0;
        void updateJob(job.id, {
          progress: pct,
          bytesDownloaded: downloaded,
          bytesTotal: total || null,
        });
      }
    },
    headers,
  );

  // Use the server-suggested name (Vimm reveals the real archive extension here).
  const name = filename || job.uploadedFilename || basename(job.sourceUrl);
  const finalPath = join(jobDir, name);
  await rename(tmpPath, finalPath).catch(async () => {
    await copyFile(tmpPath, finalPath);
    await rm(tmpPath, { force: true }).catch(() => {});
  });
  await updateJob(job.id, {
    state: "uploading",
    uploadedFilename: name,
    releaseName: name, // keep equal so handleUploading doesn't treat it as a collection archive
    bytesDownloaded: bytes,
    progress: 0,
  });
}

async function handleUploading(
  job: DownloadJob,
  romm: RommClient,
  tmpDir: string,
  rommLibraryPath: string,
): Promise<void> {
  if (!job.uploadedFilename) {
    await failJob(job.id, "Missing filename for upload");
    return;
  }
  const jobDir = join(tmpDir, job.id);
  const downloadedPath = join(jobDir, job.uploadedFilename);

  // When the torrent was a collection archive, uploadedFilename is the archive
  // (e.g. "Minerva_Myrient.zip") but releaseName is the ROM we actually want
  // (e.g. "Donkey Kong Country (USA).zip"). Extract the ROM from the archive.
  let uploadPath = downloadedPath;
  let uploadFilename = job.uploadedFilename;

  const isCollectionArchive =
    job.releaseName &&
    job.releaseName !== job.uploadedFilename &&
    job.uploadedFilename.toLowerCase().endsWith(".zip");

  if (isCollectionArchive) {
    const extracted = await extractRomFromZip(downloadedPath, job.releaseName!, jobDir);
    if (extracted) {
      uploadPath = extracted;
      uploadFilename = job.releaseName!;
    }
    // If extraction fails (shouldn't happen, but be defensive), fall through and
    // upload the archive so the job doesn't silently fail.
  }

  // Disc-based system packed as an archive: Myrient/torrents use .zip, Vimm serves
  // disc games as .7z. Standalone emulators (PPSSPP, PCSX2, Dolphin…) can't boot a
  // zipped/7z image, so extract the raw content. Also unpack any .7z regardless of
  // platform since .7z isn't widely emulator-readable.
  //  - one content file (PSP/PS2/GC disc image) → extract it, upload normally.
  //  - many files (PS3/Wii U game folder, multi-track disc) → extract into the
  //    library as a folder ROM (needs the shared library; RomM can't be given a
  //    folder over HTTP).
  const archiveExt = extOf(uploadFilename);
  const isArchive = archiveExt === ".zip" || archiveExt === ".7z";
  if (isArchive && (DISC_PLATFORMS.has(job.targetPlatformSlug) || archiveExt === ".7z")) {
    // Extraction of a multi-GB image is slow — drive the "Installing" bar with
    // progress (throttled to ~1s).
    let lastExtract = 0;
    const onExtract = (pct: number) => {
      const now = Date.now();
      if (now - lastExtract >= 1000) {
        lastExtract = now;
        void updateJob(job.id, { progress: pct });
      }
    };
    const { files: entries, bytes: totalBytes } = await listArchiveEntries(uploadPath).catch(
      () => ({ files: [] as string[], bytes: 0 }),
    );
    if (entries.length === 1) {
      const extracted = await extractArchiveFile(
        uploadPath, entries[0], join(jobDir, "extracted"), totalBytes, onExtract,
      );
      if (extracted) {
        uploadPath = extracted;
        uploadFilename = basename(extracted);
      }
    } else if (entries.length > 1 && rommLibraryPath) {
      const folder = await extractArchiveToLibrary(
        job, romm, rommLibraryPath, uploadPath, jobDir, entries, totalBytes, onExtract,
      );
      if (folder) {
        await rm(jobDir, { recursive: true, force: true }).catch(() => {});
        await updateJob(job.id, { state: "done", progress: 100, uploadedFilename: folder });
        return;
      }
      // else: couldn't extract to the library — fall through and upload the archive.
    }
  }

  // When this app shares RomM's library on disk, write the file straight into a
  // per-game folder and scan — never the HTTP upload. This both groups multi-file
  // releases into one entry and avoids the chunked-upload/proxy-timeout path
  // entirely. A configured-but-unwritable path is a misconfiguration, so fail
  // loudly rather than silently falling back to HTTP.
  if (rommLibraryPath) {
    const placed = await placeInSharedLibrary(job, romm, rommLibraryPath, uploadPath, uploadFilename);
    if (!placed) {
      await failJob(
        job.id,
        `ROMM_LIBRARY_PATH is set ("${rommLibraryPath}") but the file couldn't be written ` +
          `there. Check the path is mounted and writable by this app, then retry.`,
      );
      return;
    }
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
    await updateJob(job.id, { state: "done", progress: 100, uploadedFilename: uploadFilename });
    return;
  }

  let lastPct = -1;
  const { finalized } = await romm.uploadRom(
    uploadPath,
    job.targetPlatformId,
    uploadFilename,
    (sent, total) => {
      const pct = total ? Math.round((sent / total) * 100) : 0;
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        void updateJob(job.id, { progress: pct });
      }
    },
  );

  // If the finalize timed out at RomM's proxy, the server is likely still
  // assembling a large file. Don't fail — wait for the ROM to actually appear.
  if (!finalized) {
    const landed = await waitForRom(romm, uploadFilename, job.targetPlatformId);
    if (!landed) {
      await failJob(
        job.id,
        "RomM didn't confirm the upload in time (its proxy timed out finalizing a large " +
          "file). The file may still appear after RomM finishes assembling it — re-scan " +
          "the library, or retry this download.",
      );
      return;
    }
  } else {
    // Best-effort scan so RomM registers the new file; watcher also auto-rescans.
    await romm.triggerScan(job.targetPlatformId);
  }

  // RomM writes incoming chunks to a hidden "<name>.<uuid>.assembling" temp file
  // and renames it on finalize. A scan that runs mid-assembly can register that
  // temp as a ghost ROM; sweep any away once our file has landed.
  await romm.deleteAssemblingGhosts(uploadFilename, job.targetPlatformId).catch(() => {});

  // Clean up the entire job tmp dir (archive + extracted file if any).
  await rm(jobDir, { recursive: true, force: true }).catch(() => {});

  await updateJob(job.id, { state: "done", progress: 100, uploadedFilename: uploadFilename });
}

/**
 * Poll RomM until a ROM with the uploaded filename appears. Used after a finalize
 * that timed out at the proxy while RomM was still assembling a large file.
 *
 * RomM's filesystem watcher registers the file once assembly finishes and the
 * temp is renamed, so this mostly just polls. A scan is triggered only as an
 * infrequent fallback and never in the first couple of minutes — a scan during
 * assembly would catch the half-written ".assembling" temp and create a ghost.
 */
async function waitForRom(
  romm: RommClient,
  fsName: string,
  platformId: number,
  timeoutMs = 10 * 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let nextFallbackScan = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const found = await romm.findRomByFsName(fsName, platformId).catch(() => undefined);
    if (found) return true;
    if (Date.now() >= nextFallbackScan) {
      nextFallbackScan = Date.now() + 120_000;
      await romm.triggerScan(platformId).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  return false;
}

/** True if `root` is set and we can actually write into it (shared RomM library). */
async function isLibraryWritable(root: string): Promise<boolean> {
  if (!root) return false;
  const probe = join(root, `.rd-write-test-${process.pid}`);
  try {
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Filesystem-safe folder name from a game title (RomM matches it to metadata). */
function sanitizeFolderName(title: string): string {
  return title.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The platform's real fs_slug from RomM (falls back to the job's slug). */
async function resolvePlatformFsSlug(romm: RommClient, job: DownloadJob): Promise<string> {
  try {
    const platforms = await romm.listPlatforms();
    const match = platforms.find((p) => p.id === job.targetPlatformId);
    if (match?.fs_slug) return match.fs_slug;
  } catch {
    // fall back to the job's slug
  }
  return toRommFsSlug(job.targetPlatformSlug);
}

/**
 * Extract a multi-file archive (a PS3/Wii U game folder, or a multi-track disc)
 * straight into RomM's library so RomM registers it as one folder ROM. `entries`
 * are the archive's content file paths (junk already filtered). Extracts into the
 * job's tmp dir (same volume as the library), then moves the game folder into
 * place. Returns false if the library isn't usable.
 */
async function extractArchiveToLibrary(
  job: DownloadJob,
  romm: RommClient,
  libraryRoot: string,
  archivePath: string,
  jobDir: string,
  entries: string[],
  totalBytes = 0,
  onProgress?: (pct: number) => void,
): Promise<string | null> {
  if (!(await isLibraryWritable(libraryRoot))) return null;
  const platformDir = join(libraryRoot, await resolvePlatformFsSlug(romm, job));
  const extractDir = join(jobDir, "extracted");
  await rm(extractDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(extractDir, { recursive: true });
  try {
    await extractWithProgress(["x", "-y", `-o${extractDir}`, archivePath], extractDir, totalBytes, onProgress);
  } catch {
    return null;
  }

  // If the archive holds a single top-level folder (e.g. PS3 "Game/PS3_GAME/…"),
  // that folder IS the game. Otherwise (loose files at the root, e.g. a .bin+.cue
  // disc) wrap them in a per-game folder named after the title.
  const top = new Set(entries.map((e) => e.split("/")[0]));
  const nested = entries.some((e) => e.includes("/"));
  let folderName: string;
  let srcDir: string;
  if (top.size === 1 && nested) {
    folderName = [...top][0];
    srcDir = join(extractDir, folderName);
  } else {
    folderName = sanitizeFolderName(job.title);
    srcDir = join(extractDir, "__game__");
    await mkdir(srcDir, { recursive: true });
    for (const dirent of await readdir(extractDir, { withFileTypes: true })) {
      if (dirent.isFile() && !IGNORE_EXT.has(extOf(dirent.name))) {
        await rename(join(extractDir, dirent.name), join(srcDir, dirent.name));
      }
    }
  }

  await mkdir(platformDir, { recursive: true });
  const dest = join(platformDir, folderName);
  await rm(dest, { recursive: true, force: true }).catch(() => {});
  try {
    await rename(srcDir, dest); // instant when tmp shares the library's filesystem
  } catch {
    await cp(srcDir, dest, { recursive: true }); // cross-filesystem fallback
  }

  const existing = await romm.findRomByFsName(folderName, job.targetPlatformId).catch(() => undefined);
  await romm.triggerScan(job.targetPlatformId, existing ? [existing.id] : undefined);
  return folderName;
}

/**
 * Write a downloaded file straight into RomM's library, inside a per-game folder,
 * then scan. Files for the same title land in the same folder, so RomM groups
 * them into a single ROM — which its HTTP upload can't do (it can't create the
 * folder). Returns false if the shared path isn't usable so the caller can fall
 * back to the HTTP upload.
 */
async function placeInSharedLibrary(
  job: DownloadJob,
  romm: RommClient,
  libraryRoot: string,
  srcPath: string,
  filename: string,
): Promise<boolean> {
  // The folder must sit under the platform's real fs_slug.
  const fsSlug = await resolvePlatformFsSlug(romm, job);

  // Only a multi-file set (fanned-out siblings sharing one debrid transfer) needs
  // a per-game folder to group them. A single file goes straight to the platform
  // dir, matching RomM's normal single-file layout.
  const grouped = job.debridId ? (await countJobsByDebridId(job.debridId)) > 1 : false;
  const folderName = grouped ? sanitizeFolderName(job.title) : null;
  const destDir = folderName ? join(libraryRoot, fsSlug, folderName) : join(libraryRoot, fsSlug);
  const finalPath = join(destDir, filename);
  try {
    await mkdir(destDir, { recursive: true });
    // Move into place. rename is atomic when src shares the library's filesystem;
    // otherwise copy via a hidden temp then rename within the folder so a scan
    // never catches a partial file.
    try {
      await rename(srcPath, finalPath);
    } catch {
      const tmpPath = join(destDir, `.${filename}.part`);
      await copyFile(srcPath, tmpPath);
      await rename(tmpPath, finalPath);
      await rm(srcPath, { force: true }).catch(() => {});
    }
  } catch {
    return false; // not mounted / not writable — fall back to HTTP upload
  }

  // For a grouped folder, a plain scan only registers the files present when the
  // folder-ROM is first created; once it exists, RomM won't re-read the folder
  // unless we target it. So if the folder-ROM already exists, rescan it by id —
  // each sibling does this, so the last one in picks up every file.
  let romIds: number[] | undefined;
  if (folderName) {
    const existing = await romm.findRomByFsName(folderName, job.targetPlatformId).catch(() => undefined);
    if (existing) romIds = [existing.id];
  }
  await romm.triggerScan(job.targetPlatformId, romIds);
  return true;
}

/**
 * Open a ZIP archive and extract the entry whose basename matches targetBasename.
 * Returns the path to the extracted file, or null if the entry wasn't found.
 * Uses the central directory (seeked from EOF) so it does not read the whole archive
 * into memory before finding the target entry.
 */
async function extractRomFromZip(
  zipPath: string,
  targetBasename: string,
  destDir: string,
): Promise<string | null> {
  await mkdir(destDir, { recursive: true });
  const dir = await unzipper.Open.file(zipPath);
  const entry = dir.files.find((f: unzipper.File) => basename(f.path) === basename(targetBasename));
  if (!entry) return null;

  const destPath = join(destDir, basename(targetBasename));
  await new Promise<void>((resolve, reject) =>
    entry.stream().pipe(createWriteStream(destPath)).on("finish", resolve).on("error", reject),
  );
  return destPath;
}
