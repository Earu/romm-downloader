import "server-only";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import unzipper from "unzipper";
import { getConfig } from "@/lib/config";
import type { DownloadJob } from "@/lib/db/schema";
import { resolveMagnet } from "@/lib/minerva/client";
import { RommClient } from "@/lib/romm/client";
import { TorboxClient } from "@/lib/torbox/client";
import { streamUrlToFile } from "./download";
import { failJob, updateJob } from "./queue";
import { downloadSelectedFile } from "./torrent";

/** Advance a single job by one step. Long steps (fetch/upload) run to completion. */
export async function advanceJob(job: DownloadJob): Promise<void> {
  const cfg = await getConfig();
  try {
    switch (job.state) {
      case "requested":
        return await handleResolve(job);
      case "adding":
        return await handleAdd(job, new TorboxClient(requireKey(cfg.torboxApiKey)));
      case "caching":
        return await handleCaching(job, new TorboxClient(requireKey(cfg.torboxApiKey)));
      case "fetching":
        return await handleFetching(
          job,
          new TorboxClient(requireKey(cfg.torboxApiKey)),
          cfg.downloadTmpDir,
        );
      case "local_fetching":
        return await handleLocalFetching(job, cfg.downloadTmpDir);
      case "uploading":
        return await handleUploading(
          job,
          new RommClient({ baseUrl: cfg.rommUrl, token: cfg.rommToken }),
          cfg.downloadTmpDir,
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

function requireKey(key: string): string {
  if (!key) throw new Error("TorBox API key not configured");
  return key;
}

async function handleResolve(job: DownloadJob): Promise<void> {
  if (!job.minervaPath) {
    await failJob(job.id, "No Minerva ROM path on job");
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
    state: "adding",
    releaseName: resolved.fileName,
    magnetOrHash: acquire,
    bytesTotal: resolved.size ?? null,
    uploadedFilename: resolved.fileName,
    minervaSoId: resolved.soId ?? null,
  });
}

async function handleAdd(job: DownloadJob, torbox: TorboxClient): Promise<void> {
  if (!job.magnetOrHash) {
    await failJob(job.id, "No magnet/hash on job");
    return;
  }
  const { torrent_id } = await torbox.createTorrent(job.magnetOrHash);
  await updateJob(job.id, { state: "caching", torboxId: torrent_id, progress: 0 });
}

async function handleCaching(job: DownloadJob, torbox: TorboxClient): Promise<void> {
  if (job.torboxId == null) {
    await failJob(job.id, "No TorBox id on job");
    return;
  }
  const torrent = await torbox.getTorrent(job.torboxId);
  if (!torrent) return; // not visible yet; try again next tick

  const ready = torrent.download_finished || torrent.download_present;
  if (!ready) {
    await updateJob(job.id, { progress: Math.round((torrent.progress ?? 0) * 100) });
    return;
  }

  // Minerva packs an entire platform set into ONE torrent and the file we want
  // is identified by name. TorBox only exposes the files it has cached for a
  // torrent (and ignores the magnet's `&so` selection), so the file may or may
  // not be available. Pick deliberately:
  //   1. exact file present  -> the right individual ROM (use directly)
  //   2. whole-set archive    -> a single Minerva_Myrient.zip to extract from
  //   3. neither              -> TorBox doesn't have our ROM: fail, never upload
  //      some other game that merely happens to be cached.
  const files = (torrent.files ?? []).filter((f) => !basename(f.name).startsWith("."));
  const wanted = job.releaseName ? basename(job.releaseName).toLowerCase() : null;

  let file = wanted
    ? files.find((f) => basename(f.name).toLowerCase() === wanted)
    : undefined;

  if (!file) {
    file = files.find((f) => {
      const b = basename(f.name).toLowerCase();
      return b.startsWith("minerva_myrient") && b.endsWith(".zip");
    });
  }

  if (!file) {
    // TorBox can't serve this file (it only caches a subset of the bundle and
    // ignores `&so`). Hand off to the user: the built-in torrent client CAN
    // fetch just this file via select-only. Park the job in "unavailable".
    const available = files.map((f) => basename(f.name)).slice(0, 4).join(", ");
    await updateJob(job.id, {
      state: "unavailable",
      error:
        `TorBox doesn't have "${job.releaseName}" cached for this bundle torrent` +
        (available ? ` (it only has: ${available})` : "") +
        `.`,
    });
    return;
  }

  await updateJob(job.id, {
    state: "fetching",
    torboxFileId: file.id,
    bytesTotal: file.size,
    // The downloaded filename; when it's a whole-set archive it differs from
    // releaseName and handleUploading extracts the requested ROM from it.
    uploadedFilename: basename(file.name),
    progress: 0,
  });
}

/**
 * Fallback download path: fetch just the requested file from the Minerva bundle
 * torrent with the built-in WebTorrent client (honours `&so`), then hand off to
 * upload. Used when the user opts into the local torrent for an "unavailable" job.
 */
async function handleLocalFetching(job: DownloadJob, tmpDir: string): Promise<void> {
  if (!job.magnetOrHash || !job.releaseName) {
    await failJob(job.id, "Missing magnet for local torrent download");
    return;
  }
  const jobDir = join(tmpDir, job.id);
  await mkdir(jobDir, { recursive: true });

  let lastWrite = 0;
  const result = await downloadSelectedFile(
    job.magnetOrHash,
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

  // WebTorrent writes into nested torrent folders; flatten to jobDir/<name> so
  // handleUploading finds it. releaseName === name here (we got the exact file).
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
  torbox: TorboxClient,
  tmpDir: string,
): Promise<void> {
  if (job.torboxId == null || job.torboxFileId == null || !job.uploadedFilename) {
    await failJob(job.id, "Missing TorBox file info");
    return;
  }
  const url = await torbox.requestDownloadLink(job.torboxId, job.torboxFileId);
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

  let lastPct = -1;
  await romm.uploadRom(uploadPath, job.targetPlatformId, uploadFilename, (sent, total) => {
    const pct = total ? Math.round((sent / total) * 100) : 0;
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      void updateJob(job.id, { progress: pct });
    }
  });

  // Best-effort scan so RomM registers the new file; watcher also auto-rescans.
  await romm.triggerScan(job.targetPlatformId);

  // Clean up the entire job tmp dir (archive + extracted file if any).
  await rm(jobDir, { recursive: true, force: true }).catch(() => {});

  await updateJob(job.id, { state: "done", progress: 100, uploadedFilename: uploadFilename });
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
