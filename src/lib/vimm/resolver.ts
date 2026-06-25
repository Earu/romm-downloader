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
  /** Clean filename to store in RomM (Vimm serves a zip). */
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
}

/** Parse `/vault/<id>">Title` rows (with region flag) out of a Vimm list page. */
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
    // The region flag for this row sits in the next cell; grab the first one.
    const flag = /flags\/([a-z-]+)\.png/i.exec(html.slice(re.lastIndex, re.lastIndex + 300));
    out.push({ id: m[1], title, region: flag?.[1]?.toLowerCase() });
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

/** Pick the candidate whose title best matches the query (USA preferred). */
function pickBest(candidates: Candidate[], query: string): Candidate | null {
  const q = normalize(query);
  let best: { c: Candidate; score: number } | null = null;
  for (const c of candidates) {
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
    score += regionBonus(c.region);
    if (!best || score > best.score) best = { c, score };
  }
  // Require a minimum confidence so we don't grab an unrelated game.
  return best && best.score >= 20 ? best.c : null;
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

  // The embedded `media` JSON carries the real filename (base64 GoodTitle).
  let fileName = `vimm-${mediaId}.zip`;
  const mediaM = /let\s+media\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (mediaM) {
    try {
      const media = JSON.parse(mediaM[1]) as { GoodTitle?: string }[];
      const good = media[0]?.GoodTitle;
      if (good) {
        const decoded = Buffer.from(good, "base64").toString("utf8");
        // Vimm serves a zip; replace the inner ROM extension with .zip.
        fileName = decoded.replace(/\.[^.]+$/, "") + ".zip";
      }
    } catch {
      // keep the fallback name
    }
  }
  return { url, fileName };
}

/**
 * Resolve a game to a Vimm's Lair direct download. Returns null if the platform
 * isn't on Vimm, nothing matches confidently, or the page can't be parsed.
 */
export async function resolveVimm(
  rawTitle: string,
  platformSlug: string,
): Promise<VimmResolved | null> {
  const system = SLUG_TO_VIMM[platformSlug];
  if (!system) return null;

  const query = cleanTitle(rawTitle);
  if (query.length < 2) return null;

  const searchUrl = `${VIMM_BASE}/vault/?p=list&q=${encodeURIComponent(query)}&system=${encodeURIComponent(system)}`;
  const listHtml = await fetchText(searchUrl);
  if (!listHtml) return null;

  const best = pickBest(parseSearchResults(listHtml), query);
  if (!best) return null;

  const vaultUrl = `${VIMM_BASE}/vault/${best.id}`;
  const vaultHtml = await fetchText(vaultUrl);
  if (!vaultHtml) return null;

  const parsed = parseVaultPage(vaultHtml);
  if (!parsed) return null;

  return { url: parsed.url, headers: vimmHeaders(), fileName: parsed.fileName, vaultUrl };
}
