import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getDebridProvider } from "@/lib/debrid";
import { RommClient } from "@/lib/romm/client";

export const dynamic = "force-dynamic";

interface ServiceHealth {
  configured: boolean;
  ok: boolean;
  detail?: string;
}

/** Connectivity + auth check for RomM, the debrid provider, and the IGDB catalog. */
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

  const provider = getDebridProvider(cfg);
  const debrid: ServiceHealth = { configured: Boolean(provider), ok: false };
  if (provider) {
    try {
      await provider.ping();
      debrid.ok = true;
      debrid.detail = `${provider.label} key valid`;
    } catch (e) {
      debrid.detail = `${provider.label}: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    debrid.detail = "none — downloads use the built-in torrent client";
  }

  const igdb: ServiceHealth = {
    configured: Boolean(cfg.igdbClientId && cfg.igdbClientSecret),
    ok: Boolean(cfg.igdbClientId && cfg.igdbClientSecret),
    detail:
      cfg.igdbClientId && cfg.igdbClientSecret
        ? "credentials present"
        : "set IGDB_CLIENT_ID/SECRET to enable catalog",
  };

  return NextResponse.json({ romm, debrid, igdb });
}
