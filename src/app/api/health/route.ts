import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { RommClient } from "@/lib/romm/client";
import { TorboxClient } from "@/lib/torbox/client";

export const dynamic = "force-dynamic";

interface ServiceHealth {
  configured: boolean;
  ok: boolean;
  detail?: string;
}

/** Connectivity + auth check for RomM, TorBox, and the IGDB catalog. */
export async function GET() {
  const cfg = await getConfig();

  const romm: ServiceHealth = { configured: Boolean(cfg.rommUrl), ok: false };
  if (cfg.rommUrl) {
    try {
      const client = new RommClient({ baseUrl: cfg.rommUrl, token: cfg.rommToken });
      const hb = await client.heartbeat();
      if (cfg.rommToken) {
        const me = await client.me();
        romm.detail = `v${hb.SYSTEM.VERSION}, authed as ${me.username}`;
      } else {
        romm.detail = `v${hb.SYSTEM.VERSION}, no token`;
      }
      romm.ok = Boolean(cfg.rommToken);
    } catch (e) {
      romm.detail = e instanceof Error ? e.message : String(e);
    }
  }

  const torbox: ServiceHealth = { configured: Boolean(cfg.torboxApiKey), ok: false };
  if (cfg.torboxApiKey) {
    try {
      await new TorboxClient(cfg.torboxApiKey).ping();
      torbox.ok = true;
      torbox.detail = "API key valid";
    } catch (e) {
      torbox.detail = e instanceof Error ? e.message : String(e);
    }
  }

  const igdb: ServiceHealth = {
    configured: Boolean(cfg.igdbClientId && cfg.igdbClientSecret),
    ok: Boolean(cfg.igdbClientId && cfg.igdbClientSecret),
    detail:
      cfg.igdbClientId && cfg.igdbClientSecret
        ? "credentials present"
        : "set IGDB_CLIENT_ID/SECRET to enable catalog",
  };

  return NextResponse.json({ romm, torbox, igdb });
}
