import { NextResponse } from "next/server";
import { listJobFiles } from "@/lib/jobs/orchestrator";
import { getJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/** Candidate game files for a parked multi_file job, for the picker modal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const files = await listJobFiles(job);
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
