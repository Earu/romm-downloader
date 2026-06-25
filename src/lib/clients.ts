import "server-only";
import { getConfig } from "@/lib/config";
import { RommClient } from "@/lib/romm/client";

/** Build a RomM client from effective config (DB settings over env). */
export async function getRommClient(): Promise<RommClient> {
  const cfg = await getConfig();
  return new RommClient({ baseUrl: cfg.rommUrl, token: cfg.rommToken });
}
