import { NextResponse } from "next/server";
import { MinervaNotSyncedError, search } from "@/lib/minerva/client";

export const dynamic = "force-dynamic";

/** GET /api/minerva/search?q=super+mario&all=1 — search the cached Minerva index. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  // ?all=1 includes non-game content (documentation, software, music, …).
  const gamesOnly = url.searchParams.get("all") !== "1";
  if (q.trim().length < 3) {
    return NextResponse.json({ results: [], error: "Type at least 3 characters" });
  }
  try {
    const results = await search(q, { gamesOnly });
    return NextResponse.json({ results });
  } catch (e) {
    if (e instanceof MinervaNotSyncedError) {
      return NextResponse.json({ results: [], notSynced: true, error: e.message });
    }
    return NextResponse.json(
      { results: [], error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
