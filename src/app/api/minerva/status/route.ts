import { NextResponse } from "next/server";
import { getSyncStatus, runSync } from "@/lib/minerva/sync";

export const dynamic = "force-dynamic";

/** GET — current Minerva sync status (last synced, size, in-progress %). */
export async function GET() {
  return NextResponse.json(await getSyncStatus());
}

/** POST — trigger a manual sync (no-op if one is already running). */
export async function POST() {
  // Fire and forget; the long download runs in the background. Clients poll GET.
  void runSync();
  return NextResponse.json(await getSyncStatus());
}
