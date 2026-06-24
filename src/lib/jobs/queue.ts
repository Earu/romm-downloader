import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { type DownloadJob, downloadJobs, type JobState } from "@/lib/db/schema";

const TERMINAL: JobState[] = ["done", "failed"];

export interface CreateJobInput {
  minervaPath: string;
  title: string;
  catalogGameId?: string;
  coverUrl?: string;
  targetPlatformId: number;
  targetPlatformSlug: string;
}

export async function createJob(input: CreateJobInput): Promise<DownloadJob> {
  const id = randomUUID();
  await db.insert(downloadJobs).values({
    id,
    minervaPath: input.minervaPath,
    catalogGameId: input.catalogGameId ?? null,
    title: input.title,
    coverUrl: input.coverUrl ?? null,
    targetPlatformId: input.targetPlatformId,
    targetPlatformSlug: input.targetPlatformSlug,
    state: "requested",
  });
  return getJob(id) as Promise<DownloadJob>;
}

export async function getJob(id: string): Promise<DownloadJob | undefined> {
  return db.select().from(downloadJobs).where(eq(downloadJobs.id, id)).get();
}

export async function listJobs(): Promise<DownloadJob[]> {
  return db.select().from(downloadJobs).orderBy(desc(downloadJobs.createdAt)).all();
}

/** Jobs that the worker should still act on (non-terminal). */
export async function listActiveJobs(): Promise<DownloadJob[]> {
  return db
    .select()
    .from(downloadJobs)
    .where(notInArray(downloadJobs.state, TERMINAL))
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
