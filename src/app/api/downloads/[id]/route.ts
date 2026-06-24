import { NextResponse } from "next/server";
import { cleanupJobFiles } from "@/lib/jobs/orchestrator";
import { deleteJob, getJob, retryJob, updateJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}

/**
 * Job actions. Body `{ action: "retry" | "local" }` (defaults to retry):
 * - retry: reset a failed job to the start.
 * - local: an "unavailable" job opts into the built-in torrent client.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const action = await req
    .json()
    .then((b) => (b?.action as string | undefined) ?? "retry")
    .catch(() => "retry");

  if (action === "local") {
    await updateJob(id, {
      state: "local_fetching",
      error: null,
      progress: 0,
      bytesDownloaded: null,
    });
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
