import "server-only";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import unzipper from "unzipper";
import { type AppConfig, getConfig } from "@/lib/config";
import { type AcquireHint, type DebridProvider, getDebridProvider } from "@/lib/debrid";
import type { DownloadJob } from "@/lib/db/schema";
import { resolveMagnet } from "@/lib/minerva/client";
import { RommClient } from "@/lib/romm/client";
import { streamUrlToFile } from "./download";
import { failJob, updateJob } from "./queue";
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
        return await handleCaching(job, requireProvider(cfg), cfg.maxDebridGb);
      case "fetching":
        return await handleFetching(job, requireProvider(cfg), cfg.downloadTmpDir);
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

function requireProvider(cfg: AppConfig): DebridProvider {
  const provider = getDebridProvider(cfg);
  if (!provider) throw new Error("No debrid provider configured");
  return provider;
}

function hintOf(job: DownloadJob): AcquireHint {
  return { releaseName: job.releaseName, soId: job.minervaSoId };
}

async function handleResolve(job: DownloadJob, hasDebrid: boolean): Promise<void> {
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
    // With no debrid provider configured, go straight to the built-in torrent
    // client (aria2); otherwise add to the debrid service first.
    state: hasDebrid ? "adding" : "local_fetching",
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

  // Minerva packs an entire platform set into ONE torrent and the file we want
  // is identified by name. A debrid service exposes whatever files it has for
  // the transfer, so the file may or may not be available. Pick deliberately:
  //   1. exact file present  -> the right individual ROM (use directly)
  //   2. whole-set archive    -> a single Minerva_Myrient.zip to extract from
  //   3. neither              -> the provider doesn't have our ROM: hand off to
  //      the user, never upload some other game that happens to be present.
  const files = status.files.filter((f) => !basename(f.name).startsWith("."));
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
  const maxBytes = maxDebridGb * 1024 ** 3;
  if (file.size != null && file.size > maxBytes) {
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
 * Fallback download path: fetch just the requested file from the Minerva bundle
 * torrent with the built-in WebTorrent client (honours `&so`), then hand off to
 * upload. Used when the user opts into the local torrent for an "unavailable" job.
 */
async function handleLocalFetching(job: DownloadJob, tmpDir: string): Promise<void> {
  if (!job.minervaPath || !job.releaseName) {
    await failJob(job.id, "Missing ROM path for local torrent download");
    return;
  }
  const jobDir = join(tmpDir, job.id);
  await mkdir(jobDir, { recursive: true });

  // Prefer the actual .torrent file — it carries Minerva's full, working tracker
  // list (our hardcoded magnet trackers are mostly dead, so the magnet finds no
  // peers). Fall back to the magnet only if there's no .torrent.
  const resolved = await resolveMagnet(job.minervaPath);
  let source: string | Buffer | undefined;
  if (resolved.torrentUrl) {
    const res = await fetch(resolved.torrentUrl, { cache: "no-store" });
    if (res.ok) source = Buffer.from(await res.arrayBuffer());
  }
  if (!source) source = resolved.magnet ?? job.magnetOrHash ?? undefined;
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
