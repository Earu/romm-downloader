import { NextResponse } from "next/server";
import { getRommClient } from "@/lib/clients";
import { toInstalledRom } from "@/lib/romm/installed";

export const dynamic = "force-dynamic";

/** GET /api/roms/:id — a single installed ROM (for the detail page). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const client = await getRommClient();
    const rom = await client.getRom(Number(id));
    return NextResponse.json({ rom: toInstalledRom(rom) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

/** DELETE /api/roms/:id — uninstall (remove from RomM DB + filesystem). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const client = await getRommClient();
    await client.deleteRom(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
