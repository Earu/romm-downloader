import { PLATFORM_BY_SLUG } from "@/lib/platforms";

/**
 * Maps a Minerva archive path to a RomM/IGDB platform. Minerva paths are
 * structured as `./<Collection>/<Manufacturer - Console>/<file>`, so the path
 * itself tells us both whether an entry is a game and which platform it targets.
 *
 * Entries that don't resolve to a known game platform (TOSEC software, bitsavers
 * manuals, laserdiscs, OSTs, magazine scans, music, amiibo dumps, …) return null
 * and are treated as non-game noise by the search layer.
 */
export interface InferredPlatform {
  slug: string;
  name: string;
}

/**
 * Arcade-romset collections, mapped to the specific subfolders that hold actual
 * arcade games. These collections also carry per-system "Software List" folders
 * (psx, megacd, snes, …) that merely duplicate No-Intro/Redump under cryptic
 * short names, plus EXTRAs/Multimedia/BIOS noise — all excluded here. For MAME we
 * pick a single canonical rom set so the same game doesn't appear 3× (split /
 * merged / non-merged).
 */
const ARCADE_SUBFOLDERS: Record<string, Set<string>> = {
  MAME: new Set(["ROMs (non-merged)", "CHDs (merged)"]),
  HBMAME: new Set(["ROMs (merged)"]),
  "FinalBurn Neo": new Set(["arcade"]),
};

// Cartridge/disc preservation sets organised by `Manufacturer - Console` folder.
const ROMSET_COLLECTIONS = new Set(["No-Intro", "Redump"]);

/**
 * Normalised console-folder name → platform slug. Keys are folder names after
 * {@link normalizeFolder} strips edition prefixes/suffixes, so a single key
 * covers all variants (Aftermarket, NKit RVZ, Disc Keys, Decrypted, …).
 */
const FOLDER_TO_SLUG: Record<string, string> = {
  // Nintendo
  "Nintendo - Nintendo Entertainment System": "nes",
  "Nintendo - Super Nintendo Entertainment System": "snes",
  "Nintendo - Super Famicom": "sfc",
  "Nintendo - Nintendo 64": "n64",
  "Nintendo - GameCube": "gc",
  "Nintendo - Wii": "wii",
  "Nintendo - Wii U": "wiiu",
  "Nintendo - Game Boy": "gb",
  "Nintendo - Game Boy Color": "gbc",
  "Nintendo - Game Boy Advance": "gba",
  "Nintendo - Nintendo DS": "nds",
  "Nintendo - Nintendo DSi": "nds",
  "Nintendo - Nintendo 3DS": "3ds",
  "Nintendo - New Nintendo 3DS": "3ds",
  "Nintendo - Virtual Boy": "vb",
  "Nintendo - Family Computer Disk System": "fds",
  // Sony
  "Sony - PlayStation": "ps",
  "Sony - PlayStation 2": "ps2",
  "Sony - PlayStation 3": "ps3",
  "Sony - PlayStation Portable": "psp",
  "Sony - PlayStation Vita": "psvita",
  // Microsoft
  "Microsoft - Xbox": "xbox",
  "Microsoft - Xbox 360": "xbox360",
  "Microsoft - MSX": "msx",
  "Microsoft - MSX2": "msx2",
  // Sega
  "Sega - Mega Drive - Genesis": "genesis-slash-megadrive",
  "Sega - Master System - Mark III": "sega-master-system",
  "Sega - Master System": "sega-master-system",
  "Sega - Game Gear": "game-gear",
  "Sega - Saturn": "saturn",
  "Sega - Dreamcast": "dreamcast",
  "Sega - 32X": "32x",
  "Sega - Mega CD & Sega CD": "sega-cd",
  "Sega - SG-1000": "sg1000",
  "Sega - SG-1000 - SC-3000": "sg1000",
  // Atari
  "Atari - Atari 2600": "atari-2600",
  "Atari - Atari 5200": "atari-5200",
  "Atari - Atari 7800": "atari-7800",
  "Atari - Atari Lynx": "atari-lynx",
  "Atari - Atari Jaguar": "atari-jaguar",
  "Atari - Atari ST": "atari-st",
  // NEC
  "NEC - PC Engine - TurboGrafx-16": "turbografx-16--1",
  "NEC - PC Engine CD & TurboGrafx CD": "turbografx-cd",
  "NEC - PC Engine SuperGrafx": "supergrafx",
  "NEC - PC-FX & PC-FXGA": "pc-fx",
  // SNK
  "SNK - Neo Geo": "neo-geo-aes",
  "SNK - NeoGeo Pocket Color": "neo-geo-pocket-color",
  "SNK - NeoGeo Pocket": "neo-geo-pocket",
  "SNK - Neo Geo CD": "neo-geo-cd",
  // Bandai
  "Bandai - WonderSwan": "wonderswan",
  "Bandai - WonderSwan Color": "wonderswan-color",
  // Commodore
  "Commodore - Commodore 64": "c64",
  "Commodore - Amiga": "amiga",
  "Commodore - Amiga CD": "amiga",
  "Commodore - Amiga CD32": "amiga",
  "Commodore - VIC-20": "vic-20",
  // Apple
  "Apple - Macintosh": "mac",
  "Apple - II": "apple-ii",
  "Apple - IIGS": "apple-iigs",
  // Sinclair
  "Sinclair - ZX Spectrum": "zxs",
  "Sinclair - ZX Spectrum +3": "zxs",
  // Other
  "Mattel - Intellivision": "intellivision",
  "Coleco - ColecoVision": "colecovision",
  "Magnavox - Odyssey 2": "odyssey-2",
  "GCE - Vectrex": "vectrex",
  "Panasonic - 3DO Interactive Multiplayer": "3do",
  "Philips - CD-i": "cdi",
  "Fujitsu - FM-Towns": "fm-towns",
  // IBM PC-compatible floppy/disc sets are predominantly DOS-era games.
  "IBM - PC and Compatibles": "dos",
  "IBM - PC compatible": "dos",
};

/**
 * Strip edition prefixes (Unofficial/Non-Redump/TEMP), trailing parentheticals
 * ((Aftermarket), (Misc), (Flux), …), and dump-format suffixes (- NKit RVZ,
 * - Disc Keys, - GDI Files, - Decrypted, …) to reduce a folder to its base
 * console name for {@link FOLDER_TO_SLUG} lookup.
 */
function normalizeFolder(folder: string): string {
  let s = folder;
  s = s.replace(/^Unofficial - /, "");
  s = s.replace(/^Non-Redump - /, "");
  s = s.replace(/^TEMP /, "");
  // Dump-format / packaging suffixes appended after a " - ".
  s = s.replace(
    / - (NKit|RVZ|GCZ|WUX|WBFS|Disc Keys|GDI|CHD|SBI|BIOS|Decrypted|Encrypted)\b.*$/,
    "",
  );
  // Trailing parenthetical qualifiers, possibly several.
  while (/ \([^)]*\)$/.test(s)) s = s.replace(/ \([^)]*\)$/, "");
  return s.trim();
}

/** Resolve a Minerva full_path to a known game platform, or null if it's noise. */
export function inferPlatform(fullPath: string): InferredPlatform | null {
  // parts: ["", ".", "<Collection>", "<Console folder>", ...] for "./A/B/c".
  const parts = fullPath.replace(/^\.\//, "").split("/");
  const collection = parts[0];
  if (!collection) return null;

  const arcadeSubs = ARCADE_SUBFOLDERS[collection];
  if (arcadeSubs) {
    return arcadeSubs.has(parts[1]) ? platformBySlug("arcade") : null;
  }

  if (ROMSET_COLLECTIONS.has(collection)) {
    const folder = parts[1];
    if (!folder) return null;
    const slug = FOLDER_TO_SLUG[normalizeFolder(folder)];
    return slug ? platformBySlug(slug) : null;
  }

  return null;
}

function platformBySlug(slug: string): InferredPlatform | null {
  const p = PLATFORM_BY_SLUG.get(slug);
  return p ? { slug: p.slug, name: p.name } : null;
}

/**
 * Every platform slug we can actually acquire ROMs for: the targets of the
 * Minerva folder map plus arcade. Used to hide catalog games that only exist on
 * platforms we don't support. These are IGDB-style slugs, so they match
 * `CatalogGame.platforms[].slug` directly.
 */
export const SUPPORTED_SLUGS: ReadonlySet<string> = new Set([
  ...Object.values(FOLDER_TO_SLUG),
  "arcade",
]);

/** True if a game has at least one platform we support. */
export function hasSupportedPlatform(
  platforms: { slug?: string }[],
): boolean {
  return platforms.some((p) => p.slug != null && SUPPORTED_SLUGS.has(p.slug));
}
