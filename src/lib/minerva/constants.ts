import { join } from "node:path";

export const MINERVA_BASE = "https://minerva-archive.org";
export const MINERVA_INDEX_URL = `${MINERVA_BASE}/assets/index.txt.gz`;
export const MINERVA_DB_URL = `${MINERVA_BASE}/assets/hashes.db`;

/** Local cache locations. */
export const MINERVA_DIR = process.env.MINERVA_DIR ?? join(process.cwd(), "data", "minerva");
export const MINERVA_INDEX_PATH = join(MINERVA_DIR, "index.txt");
export const MINERVA_DB_PATH = join(MINERVA_DIR, "hashes.db");
export const MINERVA_META_PATH = join(MINERVA_DIR, "sync.json");

/** Re-sync the index/db if older than this. */
export const MINERVA_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // ~1 month

/**
 * Tracker list appended to magnets, copied verbatim from Minerva's /js/rom.js.
 * Their magnets carry no trackers on their own, so this is required for peers.
 */
export const MINERVA_TRACKERS =
  "&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2F9.rarbg.com%3A2810%2Fannounce&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Fexplodie.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fopentracker.io%3A6969%2Fannounce&tr=udp%3A%2F%2Fbt1.archive.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fbt.ktrackers.com%3A6666%2Fannounce";
