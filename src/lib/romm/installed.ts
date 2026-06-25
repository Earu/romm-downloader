import type { RommRom } from "./client";

/** A ROM installed in RomM, normalised for the UI. */
export interface InstalledRom {
  id: number;
  /** Clean display title (region/tags/extension stripped). */
  name: string;
  /** Original on-disk filename. */
  fileName: string;
  platformSlug: string;
  coverUrl?: string;
  summary?: string;
  sizeBytes?: number;
  /** Normalised key for matching against catalog titles. */
  matchKey: string;
}

// Articles dropped during normalisation so "Legend of Zelda, The" (No-Intro)
// and "The Legend of Zelda" (IGDB) match regardless of word order.
const ARTICLES = new Set(["the", "a", "an"]);

/**
 * Normalise a title for fuzzy matching: drop the extension, any
 * (parenthetical)/[bracketed] tags, punctuation and leading/trailing articles,
 * then lowercase. So "Crisis Core - Final Fantasy VII (USA).zip" and the IGDB
 * "Crisis Core: Final Fantasy VII" both reduce to "crisis core final fantasy vii".
 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,4}$/, "")
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w))
    .join(" ");
}

function stripExt(s: string): string {
  return s.replace(/\.[a-z0-9]{1,4}$/i, "");
}

/** Map RomM's rich ROM object to the trimmed {@link InstalledRom}. */
export function toInstalledRom(r: RommRom): InstalledRom {
  const display = stripExt(r.fs_name_no_tags || r.name || r.fs_name || `ROM ${r.id}`);
  return {
    id: r.id,
    name: display,
    fileName: r.fs_name || r.name || "",
    platformSlug: r.platform_slug || "",
    coverUrl: r.url_cover || undefined,
    summary: r.summary || undefined,
    sizeBytes: r.fs_size_bytes,
    matchKey: normalizeTitle(r.fs_name_no_tags || r.name || r.fs_name || ""),
  };
}
