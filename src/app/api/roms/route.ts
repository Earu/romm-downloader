import { NextResponse } from "next/server";
import { getRommClient } from "@/lib/clients";
import { toInstalledRom } from "@/lib/romm/installed";

export const dynamic = "force-dynamic";

/** GET /api/roms — the installed games (ROMs) in RomM, normalised. */
export async function GET() {
  try {
    const client = await getRommClient();
    const roms = (await client.listRoms()).map(toInstalledRom);
    return NextResponse.json({ roms });
  } catch (e) {
    return NextResponse.json(
      { roms: [], error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
