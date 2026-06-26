import { NextResponse } from "next/server";
import { listVimmCandidates } from "@/lib/jobs/orchestrator";
import { getJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/** Candidate Vimm's Lair versions for a job's game, for the chooser modal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const candidates = await listVimmCandidates(job);
    return NextResponse.json({ candidates });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
