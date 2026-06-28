import { NextResponse } from "next/server";
import { getRommClient } from "@/lib/clients";
import { getConfig } from "@/lib/config";
import { getJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/**
 * Lightweight per-job tracker for the game info page (opened from a download's
 * cover). Returns the job's live state/progress, and once it's installed, a deep
 * link to the game's page on the RomM server — resolved by the uploaded filename,
 * the same way the worker confirms an upload landed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let rommUrl: string | null = null;
  if (job.state === "done" && job.uploadedFilename) {
    try {
      const [cfg, romm] = await Promise.all([getConfig(), getRommClient()]);
      const rom = await romm.findRomByFsName(job.uploadedFilename, job.targetPlatformId);
      if (rom) rommUrl = `${cfg.rommUrl.replace(/\/+$/, "")}/rom/${rom.id}`;
    } catch {
      // RomM unreachable or the ROM hasn't surfaced yet — leave null; the client
      // keeps polling and the link appears once RomM registers the file.
    }
  }

  return NextResponse.json({
    state: job.state,
    progress: job.progress,
    error: job.error,
    rommUrl,
  });
}
