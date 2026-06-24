import "server-only";
import { getConfig } from "@/lib/config";
import { RommClient } from "@/lib/romm/client";
import { TorboxClient } from "@/lib/torbox/client";

/** Build a RomM client from effective config (DB settings over env). */
export async function getRommClient(): Promise<RommClient> {
  const cfg = await getConfig();
  return new RommClient({ baseUrl: cfg.rommUrl, token: cfg.rommToken });
}

/** Build a TorBox client; throws if no API key is configured. */
export async function getTorboxClient(): Promise<TorboxClient> {
  const cfg = await getConfig();
  if (!cfg.torboxApiKey) throw new Error("TorBox API key not configured");
  return new TorboxClient(cfg.torboxApiKey);
}
