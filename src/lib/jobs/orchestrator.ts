import "server-only";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import unzipper from "unzipper";
import { type AppConfig, getConfig } from "@/lib/config";
import {
  type AcquireHint,
  type DebridFile,
  type DebridProvider,
  getDebridProvider,
} from "@/lib/debrid";
import type { DownloadJob } from "@/lib/db/schema";
import { resolveMagnet } from "@/lib/minerva/client";
import { RommClient } from "@/lib/romm/client";
import { streamUrlToFile } from "./download";
import { countJobsByDebridId, createDebridFetchJob, failJob, updateJob } from "./queue";
import { downloadSelectedFile } from "./torrent";

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
  const result = await downloadSelectedFile(
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
  const bytes = await streamUrlToFile(url, dest, (downloaded, total) => {
    const now = Date.now();
    if (now - lastWrite >= 1000) {
      lastWrite = now;
      const pct = total ? Math.round((downloaded / total) * 100) : 0;
      void updateJob(job.id, { progress: pct, bytesDownloaded: downloaded });
    }
  });
  await updateJob(job.id, { state: "uploading", bytesDownloaded: bytes, progress: 0 });
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
  // eslint-disable-next-line no-control-regex
  return title.replace(/[<>:"/\\|?* -]+/g, " ").replace(/\s+/g, " ").trim();
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
  // The folder must sit under the platform's real fs_slug; ask RomM for it,
  // falling back to the slug the job was created with.
  let fsSlug = job.targetPlatformSlug;
  try {
    const platforms = await romm.listPlatforms();
    const match = platforms.find((p) => p.id === job.targetPlatformId);
    if (match?.fs_slug) fsSlug = match.fs_slug;
  } catch {
    // Lookup failed — keep the job's slug.
  }

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
