import "server-only";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createClient } from "@libsql/client";
import {
  MINERVA_BASE,
  MINERVA_DB_PATH,
  MINERVA_INDEX_PATH,
  MINERVA_TRACKERS,
} from "./constants";
import { inferPlatform } from "./platform";
import { registerIndexInvalidator } from "./sync";

export class MinervaNotSyncedError extends Error {
  constructor() {
    super("Minerva index not synced yet — sync it from Settings");
    this.name = "MinervaNotSyncedError";
  }
}

export interface MinervaSearchResult {
  fullPath: string;
  fileName: string;
  /** Inferred RomM platform (present when resolvable from the path). */
  platformSlug?: string;
  platformName?: string;
}

export interface SearchOptions {
  limit?: number;
  /** When true (default), drop entries that don't resolve to a game platform. */
  gamesOnly?: boolean;
}

export interface MinervaResolved {
  fileName: string;
  size?: number;
  magnet?: string;
  torrentUrl?: string;
  soId?: number;
}

// In-memory search index, loaded lazily from the cached file.
let cache: { paths: string[]; lower: string[] } | null = null;
registerIndexInvalidator(() => {
  cache = null;
});

async function loadIndex(): Promise<{ paths: string[]; lower: string[] }> {
  if (cache) return cache;
  let text: string;
  try {
    text = await readFile(MINERVA_INDEX_PATH, "utf8");
  } catch {
    throw new MinervaNotSyncedError();
  }
  const paths = text.split("\n").filter((p) => p.length > 0);
  cache = { paths, lower: paths.map((p) => p.toLowerCase()) };
  return cache;
}

// Filenames that are clearly not playable games even within a game platform.
const NON_GAME_FILE = /\[BIOS\]|\(BIOS\)/i;
// Release qualifiers that mark a non-primary dump (demos, betas, hacks, DLC, …).
const JUNK_QUALIFIER =
  /\((demo|beta|proto[^)]*|sample|pirate|aftermarket|unl|program|hack|dlc|addon|kiosk)\)/i;
// Primary regions, mildly preferred so the canonical release floats up.
const PRIMARY_REGION = /\((usa|world|europe)\b/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Relevance score for a matched filename against the query tokens. Higher is
 * better. Rewards whole-word matches and exact title matches; penalises
 * non-primary dumps. Used to surface canonical releases (e.g. the PlayStation
 * "Final Fantasy VII (USA)") above the archive's raw file order.
 */
function scoreMatch(tokens: string[], fileNameLower: string): number {
  let score = 0;
  for (const t of tokens) {
    if (new RegExp(`\\b${escapeRegex(t)}\\b`).test(fileNameLower)) score += 10;
  }
  if (tokens.length && fileNameLower.startsWith(tokens[0])) score += 5;
  const stripped = fileNameLower
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/\s*\([^)]*\)/g, "")
    .trim();
  if (stripped === tokens.join(" ")) score += 50;
  if (JUNK_QUALIFIER.test(fileNameLower)) score -= 8;
  if (PRIMARY_REGION.test(fileNameLower)) score += 2;
  // Shorter names tend to be closer matches; use as a gentle tiebreaker.
  return score - fileNameLower.length * 0.01;
}

/**
 * Search the cached index, replicating Minerva's own matching (all query tokens
 * must fuzzy-match the path; tokens match char-by-char ignoring punctuation),
 * then rank matches by relevance so canonical releases surface first.
 *
 * By default only entries that resolve to a known game platform are returned
 * (filtering out documentation, software, music, scans, …); pass
 * `gamesOnly: false` to search the entire archive.
 */
export async function search(
  term: string,
  { limit = 60, gamesOnly = true }: SearchOptions = {},
): Promise<MinervaSearchResult[]> {
  const { paths, lower } = await loadIndex();
  const tokens = term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const regexes = tokens.map(
    (t) => new RegExp(t.split("").join("[^a-z0-9]*")),
  );

  // Collect every match (a full scan is ~300ms regardless), then rank, so the
  // best release wins even when it sits late in the archive's file order.
  const matches: Array<MinervaSearchResult & { score: number }> = [];
  for (let i = 0; i < lower.length; i++) {
    if (!regexes.every((re) => re.test(lower[i]))) continue;

    const fullPath = paths[i];
    const fileName = basename(fullPath);
    const platform = inferPlatform(fullPath);

    if (gamesOnly && (!platform || NON_GAME_FILE.test(fileName))) continue;

    matches.push({
      fullPath,
      fileName,
      platformSlug: platform?.slug,
      platformName: platform?.name,
      score: scoreMatch(tokens, fileName.toLowerCase()),
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit).map(({ score: _score, ...r }) => r);
}

/**
 * Resolve a chosen ROM path to its magnet (preferred) or .torrent URL by
 * querying the locally-cached hashes.db. full_path is indexed, so this is fast.
 */
export async function resolveMagnet(fullPath: string): Promise<MinervaResolved> {
  // Normalise to forward slashes for the file: URI (required on Windows).
  const dbUrl = `file:${MINERVA_DB_PATH.replace(/\\/g, "/")}`;
  const db = createClient({ url: dbUrl });
  try {
    const rs = await db.execute({
      sql: "SELECT file_name, size, magnet, so_id, torrents FROM files WHERE full_path = ? LIMIT 1",
      args: [fullPath],
    });
    const row = rs.rows[0];
    if (!row) throw new Error(`Not found in Minerva index: ${fullPath}`);

    const fileName = String(row.file_name ?? basename(fullPath));
    const size = row.size != null ? Number(row.size) : undefined;
    const rawMagnet = row.magnet ? String(row.magnet) : "";
    const soIdNum = row.so_id != null ? Number(row.so_id) : undefined;
    const soIdStr = soIdNum != null ? String(soIdNum) : "";
    const torrents = row.torrents ? String(row.torrents) : "";

    if (rawMagnet) {
      const magnet = `${rawMagnet}${MINERVA_TRACKERS}${soIdStr ? `&so=${soIdStr}` : ""}`;
      return { fileName, size, magnet, soId: soIdNum };
    }
    if (torrents) {
      return { fileName, size, torrentUrl: `${MINERVA_BASE}/assets/${torrents}`, soId: soIdNum };
    }
    throw new Error(`No magnet or torrent for: ${fullPath}`);
  } finally {
    db.close();
  }
}
