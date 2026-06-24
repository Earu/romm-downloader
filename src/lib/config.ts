import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

/**
 * Effective runtime configuration. Resolution order: DB settings row (id=1)
 * overrides environment variables. Use {@link getConfig} from server code.
 */
export interface AppConfig {
  rommUrl: string;
  rommToken: string;
  torboxApiKey: string;
  igdbClientId: string;
  igdbClientSecret: string;
  downloadTmpDir: string;
}

function fromEnv(): AppConfig {
  return {
    rommUrl: process.env.ROMM_URL ?? "http://localhost:8080",
    rommToken: process.env.ROMM_TOKEN ?? "",
    torboxApiKey: process.env.TORBOX_API_KEY ?? "",
    igdbClientId: process.env.IGDB_CLIENT_ID ?? "",
    igdbClientSecret: process.env.IGDB_CLIENT_SECRET ?? "",
    downloadTmpDir: process.env.DOWNLOAD_TMP_DIR ?? "./data/downloads",
  };
}

export async function getConfig(): Promise<AppConfig> {
  const env = fromEnv();
  try {
    const row = await db.select().from(settings).where(eq(settings.id, 1)).get();
    if (!row) return env;
    return {
      rommUrl: row.rommUrl || env.rommUrl,
      rommToken: row.rommToken || env.rommToken,
      torboxApiKey: row.torboxApiKey || env.torboxApiKey,
      igdbClientId: row.igdbClientId || env.igdbClientId,
      igdbClientSecret: row.igdbClientSecret || env.igdbClientSecret,
      downloadTmpDir: row.downloadTmpDir || env.downloadTmpDir,
    };
  } catch {
    // DB may not be migrated yet; fall back to env so /api/health still works.
    return env;
  }
}

/** Strip trailing slash so we can append `/api/...` cleanly. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
