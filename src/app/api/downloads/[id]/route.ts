import { NextResponse } from "next/server";
import { cleanupJobFiles, pickJobFile, startVimmFallback } from "@/lib/jobs/orchestrator";
import { deleteJob, getJob, retryJob, updateJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}

/**
 * Job actions. Body `{ action, fileId? }` (action defaults to retry):
 * - retry: reset a failed job to the start.
 * - local: an "unavailable" job opts into the built-in torrent client.
 * - pick: a "multi_file" job commits to a single file (`fileId`) and proceeds.
 * - vimm: download a chosen Vimm's Lair file (`vaultId`) directly over HTTP.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = (body?.action as string | undefined) ?? "retry";

  if (action === "local") {
    await updateJob(id, {
      state: "local_fetching",
      error: null,
      progress: 0,
      bytesDownloaded: null,
    });
  } else if (action === "pick") {
    const fileId = body?.fileId as string | undefined;
    if (!fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });
    const ok = await pickJobFile(job, fileId);
    if (!ok) return NextResponse.json({ error: "File no longer available" }, { status: 409 });
  } else if (action === "vimm") {
    const vaultId = body?.vaultId as string | undefined;
    if (!vaultId) return NextResponse.json({ error: "vaultId required" }, { status: 400 });
    const ok = await startVimmFallback(job, vaultId);
    if (!ok) return NextResponse.json({ error: "Couldn't resolve that Vimm download" }, { status: 409 });
  } else {
    await retryJob(id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await cleanupJobFiles(id);
  await deleteJob(id);
  return NextResponse.json({ ok: true });
}
