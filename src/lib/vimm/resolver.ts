import "server-only";

/**
 * Vimm's Lair resolver — a reliable per-game HTTP download source, used as a
 * fallback when a Minerva torrent is dead. Given a game title + RomM platform
 * slug it finds the game in Vimm's vault and returns a direct download URL.
 *
 * Flow (verified against the live site): search the vault for the title scoped
 * to the system → open the best-matching vault page → read its `mediaId` and the
 * per-game download host from the download form → the file is then
 * `GET https://<dlHost>/?mediaId=<id>` with a browser UA + `Referer: vimm.net`.
 */

const VIMM_BASE = "https://vimm.net";
// A real browser UA + Referer are required by Vimm's anti-leech.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** RomM/IGDB platform slug → Vimm system code (verified against live search). */
const SLUG_TO_VIMM: Record<string, string> = {
  nes: "NES",
  snes: "SNES",
  n64: "N64",
  gb: "GB",
  gbc: "GBC",
  gba: "GBA",
  vb: "VBoy",
  gc: "GameCube",
  wii: "Wii",
  nds: "DS",
  "3ds": "3DS",
  "genesis-slash-megadrive": "Genesis",
  "sega-master-system": "SMS",
  "game-gear": "GG",
  "sega-cd": "SegaCD",
  "32x": "Sega32X",
  saturn: "Saturn",
  dreamcast: "Dreamcast",
  ps: "PS1",
  ps2: "PS2",
  ps3: "PS3",
  psp: "PSP",
};

export interface VimmResolved {
  /** Direct download URL (GET, with the headers below). */
  url: string;
  /** Headers Vimm requires (UA + Referer). */
  headers: Record<string, string>;
  /** Real ROM name from the vault page (e.g. "...iso"), for display while
   *  downloading. The actual archive name comes from the download response. */
  fileName: string;
  /** The vault page, for reference/logging. */
  vaultUrl: string;
}

/** True if this platform has a Vimm system mapping. */
export function vimmSupportsPlatform(platformSlug: string): boolean {
  return platformSlug in SLUG_TO_VIMM;
}

/** Headers to fetch a Vimm download URL with (UA + Referer). */
export function vimmHeaders(): Record<string, string> {
  return { "User-Agent": UA, Referer: `${VIMM_BASE}/` };
}

/** Strip extension + (region)/[tag] noise to get a clean search/display title. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\.[a-z0-9]{1,4}$/i, "")
    .replace(/[([][^)\]]*[)\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface Candidate {
  id: string;
  title: string;
  region?: string; // from the row's flag image, e.g. "usa" / "europe" / "japan"
  extras?: string[]; // "Demo" / "Prototype" / "Translated" / "Unlicensed" / "Bonus Disc"
  version?: string; // revision, e.g. "1.0" / "1.1"
}

/** Parse `/vault/<id>">Title` rows (title, region, extras, version) from a list page. */
function parseSearchResults(html: string): Candidate[] {
  const out: Candidate[] = [];
  // Vimm's result rows use `href= "/vault/<id>">Title</a>` (note the space after
  // `href=`), preceded by an empty decoy `<a href="/vault/999999"></a>` — so allow
  // optional whitespace and require non-empty link text.
  const re = /href=\s*"\/vault\/(\d+)"[^>]*>([^<]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const title = m[2].trim();
    if (!title) continue;
    // The rest of this row up to the next row holds the extras badges (in the
    // title cell), the region flag cell, and the version cell.
    const row = html.slice(re.lastIndex, re.lastIndex + 600);
    const titleCell = row.slice(0, row.indexOf("</td>") + 1 || row.length);
    // Extras like Demo/Prototype are `<b class="redBorder" ... title="Demo">`.
    const extras = [...titleCell.matchAll(/class="redBorder"[^>]*title="([^"]+)"/gi)].map(
      (x) => x[1].trim(),
    );
    const flag = /flags\/([a-z-]+)\.png/i.exec(row);
    // Version sits in its own centered cell after the flag cell (e.g. ">1.0<").
    const ver = /text-align:center"[^>]*>\s*(\d+\.\d+)\s*</.exec(row);
    out.push({
      id: m[1],
      title,
      region: flag?.[1]?.toLowerCase(),
      extras: extras.length ? extras : undefined,
      version: ver?.[1],
    });
  }
  return out;
}

/** Region preference bonus — favour USA / World dumps. */
function regionBonus(region?: string): number {
  if (region === "usa") return 10;
  if (region === "world") return 7;
  if (region === "usa-europe" || region === "europe") return 3;
  return 0;
}

/** Relevance score for ordering candidates (higher = better; USA preferred). */
function scoreCandidate(c: Candidate, query: string): number {
  const q = normalize(query);
  const t = normalize(c.title);
  let score = 0;
  if (t === q) score = 100;
  else if (t.startsWith(q) || q.startsWith(t)) score = 60;
  else if (t.includes(q)) score = 40;
  else {
    const qt = q.split(" ");
    const hit = qt.filter((w) => w.length > 1 && t.includes(w)).length;
    score = (hit / Math.max(1, qt.length)) * 30;
  }
  score -= Math.abs(t.length - q.length) * 0.05; // prefer closest-length match
  score -= (c.extras?.length ?? 0) * 25; // sink demos/prototypes below clean dumps
  return score + regionBonus(c.region);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: vimmHeaders(), cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Read mediaId, download host, and clean filename from a vault page. */
function parseVaultPage(html: string): { url: string; fileName: string } | null {
  const idM = /name=\s*"mediaId"\s+value=\s*"(\d+)"/.exec(html);
  const hostM = /action=\s*"(\/\/dl\d*\.vimm\.net\/)"/.exec(html);
  if (!idM || !hostM) return null;
  const mediaId = idM[1];
  const url = `https:${hostM[1]}?mediaId=${mediaId}`;

  // The embedded `media` JSON carries the real ROM filename (base64 GoodTitle),
  // e.g. "...iso" for a disc. Use it as-is for display — the actual archive
  // extension (.7z/.zip) and the final extracted name are resolved at
  // download/upload time, so don't guess the extension here.
  let fileName = `vimm-${mediaId}`;
  const mediaM = /let\s+media\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (mediaM) {
    try {
      const media = JSON.parse(mediaM[1]) as { GoodTitle?: string }[];
      const good = media[0]?.GoodTitle;
      if (good) fileName = Buffer.from(good, "base64").toString("utf8");
    } catch {
      // keep the fallback name
    }
  }
  return { url, fileName };
}

/** A pickable Vimm result (one version/region of a game) for the chooser. */
export interface VimmCandidate {
  vaultId: string;
  title: string;
  region?: string;
  /** Extra qualifiers (Demo / Prototype / Translated / Unlicensed / Bonus Disc). */
  extras?: string[];
  /** Revision, e.g. "1.0" / "1.1". */
  version?: string;
}

/**
 * Search Vimm's Lair for a game on a platform and return the candidate versions
 * (different regions/revisions), best match first. Empty if the platform isn't
 * on Vimm or nothing was found.
 */
export async function searchVimmCandidates(
  rawTitle: string,
  platformSlug: string,
): Promise<VimmCandidate[]> {
  const system = SLUG_TO_VIMM[platformSlug];
  if (!system) return [];
  const query = cleanTitle(rawTitle);
  if (query.length < 2) return [];

  const url = `${VIMM_BASE}/vault/?p=list&q=${encodeURIComponent(query)}&system=${encodeURIComponent(system)}`;
  const html = await fetchText(url);
  if (!html) return [];

  const seen = new Set<string>();
  return parseSearchResults(html)
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => scoreCandidate(b, query) - scoreCandidate(a, query))
    .map((c) => ({
      vaultId: c.id,
      title: c.title,
      region: c.region,
      extras: c.extras,
      version: c.version,
    }));
}

/** Resolve a chosen Vimm vault id to its direct download URL + ROM filename. */
export async function resolveVimmVault(vaultId: string): Promise<VimmResolved | null> {
  if (!/^\d+$/.test(vaultId)) return null;
  const vaultUrl = `${VIMM_BASE}/vault/${vaultId}`;
  const html = await fetchText(vaultUrl);
  if (!html) return null;
  const parsed = parseVaultPage(html);
  if (!parsed) return null;
  return { url: parsed.url, headers: vimmHeaders(), fileName: parsed.fileName, vaultUrl };
}
