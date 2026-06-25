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
  /** Selected debrid service ("torbox" | "realdebrid" | ... | "none"). */
  debridProvider: string;
  /** API key for the selected debrid provider. */
  debridApiKey: string;
  /** Above this size (GB), skip the debrid provider and offer the torrent fallback. */
  maxDebridGb: number;
  igdbClientId: string;
  igdbClientSecret: string;
  downloadTmpDir: string;
  /**
   * Optional path to RomM's ROMs directory (the one containing per-platform
   * folders, usually `<romm-library>/roms`), shared with this app on disk. When
   * set, multi-file releases are written into a per-game folder there and scanned
   * so RomM groups them into ONE library entry — something RomM's HTTP upload API
   * can't do (it can't create the folder). Unset → files upload over HTTP as
   * separate entries.
   */
  rommLibraryPath: string;
}

const DEFAULT_MAX_DEBRID_GB = 30;

function fromEnv(): AppConfig {
  return {
    rommUrl: process.env.ROMM_URL ?? "http://localhost:8080",
    rommToken: process.env.ROMM_TOKEN ?? "",
    debridProvider: process.env.DEBRID_PROVIDER ?? "none",
    debridApiKey: process.env.DEBRID_API_KEY ?? "",
    maxDebridGb: Number(process.env.MAX_DEBRID_GB) || DEFAULT_MAX_DEBRID_GB,
    igdbClientId: process.env.IGDB_CLIENT_ID ?? "",
    igdbClientSecret: process.env.IGDB_CLIENT_SECRET ?? "",
    downloadTmpDir: process.env.DOWNLOAD_TMP_DIR ?? "./data/downloads",
    rommLibraryPath: process.env.ROMM_LIBRARY_PATH ?? "",
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
      debridProvider: row.debridProvider || env.debridProvider,
      debridApiKey: row.debridApiKey || env.debridApiKey,
      maxDebridGb: row.maxDebridGb ?? env.maxDebridGb,
      igdbClientId: row.igdbClientId || env.igdbClientId,
      igdbClientSecret: row.igdbClientSecret || env.igdbClientSecret,
      downloadTmpDir: row.downloadTmpDir || env.downloadTmpDir,
      rommLibraryPath: env.rommLibraryPath,
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
