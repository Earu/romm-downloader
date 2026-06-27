import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { type DownloadJob, downloadJobs, type JobState } from "@/lib/db/schema";
import type { SourceProviderId } from "@/lib/sources";
import { clearDeadTorrent, torrentIdentity } from "./dead-torrents";

const TERMINAL: JobState[] = ["done", "failed"];

export interface CreateJobInput {
  /** Where the ROM was chosen from. */
  sourceProvider: SourceProviderId;
  /** Provider-specific reference: Minerva path / Vimm vault id / pasted magnet. */
  sourceRef: string;
  title: string;
  catalogGameId?: string;
  coverUrl?: string;
  targetPlatformId: number;
  targetPlatformSlug: string;
}

export async function createJob(input: CreateJobInput): Promise<DownloadJob> {
  const { sourceProvider, sourceRef } = input;

  // Seed the working fields the existing pipeline reads: Minerva resolves its path
  // to a magnet later (keep `minervaPath` so handleLocalFetching can re-fetch the
  // .torrent for working trackers); a pasted magnet is the magnet itself; Vimm is
  // resolved to a URL during the resolve step.
  const minervaPath = sourceProvider === "minerva" ? sourceRef : null;
  const magnetOrHash = sourceProvider === "magnet" ? sourceRef : null;

  // A user pasting a magnet is an explicit "try this" — trust their judgement and
  // forget any prior dead-swarm record for it, so it's attempted again (and only
  // re-recorded if it's still dead).
  if (magnetOrHash) {
    const identity = torrentIdentity({ magnetOrHash });
    if (identity) await clearDeadTorrent(identity);
  }

  const id = randomUUID();
  await db.insert(downloadJobs).values({
    id,
    sourceProvider,
    sourceRef,
    minervaPath,
    magnetOrHash,
    catalogGameId: input.catalogGameId ?? null,
    title: input.title,
    coverUrl: input.coverUrl ?? null,
    targetPlatformId: input.targetPlatformId,
    targetPlatformSlug: input.targetPlatformSlug,
    state: "requested",
  });
  return getJob(id) as Promise<DownloadJob>;
}

/**
 * Fan out a sibling job that fetches one additional file from a debrid transfer
 * the parent job already created. Used for manual magnets whose torrent bundles
 * several game files (base game + updates + DLC) — each becomes its own RomM
 * entry while sharing the parent's single debrid transfer.
 */
export async function createDebridFetchJob(
  parent: DownloadJob,
  debridFileId: string,
  uploadedFilename: string,
  bytesTotal: number | null,
): Promise<void> {
  await db.insert(downloadJobs).values({
    id: randomUUID(),
    catalogGameId: parent.catalogGameId,
    title: parent.title,
    coverUrl: parent.coverUrl,
    minervaPath: null,
    targetPlatformId: parent.targetPlatformId,
    targetPlatformSlug: parent.targetPlatformSlug,
    releaseName: null,
    magnetOrHash: parent.magnetOrHash,
    minervaSoId: null,
    debridProvider: parent.debridProvider,
    debridId: parent.debridId,
    debridFileId,
    uploadedFilename,
    bytesTotal,
    // Skip resolve/add/cache — the transfer is ready and the file is chosen.
    state: "fetching",
  });
}

export async function getJob(id: string): Promise<DownloadJob | undefined> {
  return db.select().from(downloadJobs).where(eq(downloadJobs.id, id)).get();
}

/** How many jobs share a debrid transfer — >1 means a fanned-out multi-file set. */
export async function countJobsByDebridId(debridId: string): Promise<number> {
  const rows = await db
    .select({ id: downloadJobs.id })
    .from(downloadJobs)
    .where(eq(downloadJobs.debridId, debridId))
    .all();
  return rows.length;
}

export async function listJobs(): Promise<DownloadJob[]> {
  return db.select().from(downloadJobs).orderBy(desc(downloadJobs.createdAt)).all();
}

/** Non-terminal jobs the worker should still act on, oldest first (FIFO queue). */
export async function listActiveJobs(): Promise<DownloadJob[]> {
  return db
    .select()
    .from(downloadJobs)
    .where(notInArray(downloadJobs.state, TERMINAL))
    .orderBy(downloadJobs.createdAt)
    .all();
}

export async function updateJob(
  id: string,
  patch: Partial<Omit<DownloadJob, "id" | "createdAt">>,
): Promise<void> {
  await db
    .update(downloadJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(downloadJobs.id, id));
}

export async function failJob(id: string, error: string): Promise<void> {
  await updateJob(id, { state: "failed", error });
}

/** Reset a failed job back to the start so the worker retries it. */
export async function retryJob(id: string): Promise<void> {
  await updateJob(id, {
    state: "requested",
    error: null,
    progress: 0,
    bytesDownloaded: null,
  });
}

export async function deleteJob(id: string): Promise<void> {
  await db.delete(downloadJobs).where(eq(downloadJobs.id, id));
}
