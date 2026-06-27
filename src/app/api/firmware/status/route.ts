import { NextResponse } from "next/server";
import { getFirmwareStatus, runFirmwarePass } from "@/lib/firmware";

export const dynamic = "force-dynamic";

/** GET /api/firmware/status — pack sync status + the last install summary. */
export async function GET() {
  return NextResponse.json(await getFirmwareStatus());
}

/** POST /api/firmware/status — kick a sync + install pass (fire-and-forget).
 *  Forces a run even when auto-install is off (it's an explicit user action). */
export async function POST() {
  void runFirmwarePass(true);
  return NextResponse.json({ ok: true });
}
