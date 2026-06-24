import "server-only";

/**
 * TorBox API client. Base: https://api.torbox.app/v1/api, Bearer auth for most
 * endpoints; the download-link endpoint takes the key as a `token` query param.
 *
 * NOTE: exact search endpoint shape varies across TorBox API revisions. The
 * paths are centralised in TORBOX_PATHS below; verify against a live key during
 * end-to-end testing and adjust there if needed.
 */
const TORBOX_BASE = "https://api.torbox.app/v1/api";
// Search is a separate service (the main API 404s for search paths). Note: the
// search API is gated by TorBox plan tier — accounts without it get HTTP 429
// `{"error":"Rate limit exceeded: 0 per 1 minute"}`.
const TORBOX_SEARCH_BASE = "https://search-api.torbox.app";

const TORBOX_PATHS = {
  searchTorrents: (q: string) => `/torrents/search/${encodeURIComponent(q)}`,
  createTorrent: "/torrents/createtorrent",
  myList: "/torrents/mylist",
  requestDl: "/torrents/requestdl",
  controlTorrent: "/torrents/controltorrent",
} as const;

export interface TorboxEnvelope<T> {
  success: boolean;
  error?: string | null;
  detail?: string;
  data: T;
}

/** A search result release (normalized; TorBox returns a richer object). */
export interface TorboxSearchResult {
  title: string;
  hash: string;
  magnet?: string;
  seeders?: number;
  size?: number;
  cached?: boolean;
  raw: unknown;
}

/** A file inside a TorBox torrent. */
export interface TorboxFile {
  id: number;
  name: string;
  size: number;
}

/** A torrent in the user's TorBox cloud (from mylist). */
export interface TorboxTorrent {
  id: number;
  hash: string;
  name: string;
  download_state: string;
  download_finished: boolean;
  download_present: boolean;
  progress: number; // 0..1
  size: number;
  cached?: boolean;
  files: TorboxFile[];
}

export class TorboxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TorboxError";
  }
}

export class TorboxClient {
  constructor(private readonly apiKey: string) {}

  private async req<T>(path: string, init?: RequestInit, base = TORBOX_BASE): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init?.headers as Record<string, string>),
      },
      cache: "no-store",
    });
    const text = await res.text();
    let json: TorboxEnvelope<T> | undefined;
    try {
      json = text ? (JSON.parse(text) as TorboxEnvelope<T>) : undefined;
    } catch {
      // non-JSON body
    }
    if (!res.ok || (json && json.success === false)) {
      const detail = json?.detail || json?.error || text.slice(0, 300);
      throw new TorboxError(`TorBox ${path} failed: ${res.status} ${detail}`, res.status);
    }
    return (json ? json.data : (undefined as T)) as T;
  }

  /** Verify the key works by listing the (possibly empty) torrent cloud. */
  async ping(): Promise<boolean> {
    await this.myList();
    return true;
  }

  /** Full-text search for torrents matching a title. */
  async searchTorrents(query: string): Promise<TorboxSearchResult[]> {
    const data = await this.req<{ torrents?: unknown[] } | unknown[]>(
      TORBOX_PATHS.searchTorrents(query),
      undefined,
      TORBOX_SEARCH_BASE,
    );
    const rows = Array.isArray(data) ? data : (data?.torrents ?? []);
    return rows.map(normalizeSearchResult).filter((r): r is TorboxSearchResult => !!r);
  }

  /**
   * Add a torrent to TorBox by magnet link, info hash, or a `.torrent` file URL
   * (the latter is fetched and uploaded as the torrent file). Returns its id.
   */
  async createTorrent(input: string): Promise<{ torrent_id: number; hash: string }> {
    const form = new FormData();
    if (input.startsWith("magnet:")) {
      form.set("magnet", input);
    } else if (input.startsWith("http://") || input.startsWith("https://")) {
      const res = await fetch(input, { cache: "no-store" });
      if (!res.ok) throw new TorboxError(`fetch .torrent failed: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      form.set("file", new Blob([bytes], { type: "application/x-bittorrent" }), "file.torrent");
    } else {
      form.set("hash", input);
    }
    form.set("seed", "1");
    form.set("allow_zip", "false");
    return this.req<{ torrent_id: number; hash: string }>(TORBOX_PATHS.createTorrent, {
      method: "POST",
      body: form,
    });
  }

  /** List torrents in the user's cloud, optionally a single one by id. */
  async myList(id?: number): Promise<TorboxTorrent[]> {
    const qs = new URLSearchParams({ bypass_cache: "true" });
    if (id != null) qs.set("id", String(id));
    const data = await this.req<TorboxTorrent[] | TorboxTorrent>(
      `${TORBOX_PATHS.myList}?${qs.toString()}`,
    );
    return Array.isArray(data) ? data : data ? [data] : [];
  }

  async getTorrent(id: number): Promise<TorboxTorrent | undefined> {
    const list = await this.myList(id);
    return list[0];
  }

  /**
   * Find a torrent already in the user's cloud by its info hash. TorBox dedups
   * by hash, so this lets us detect (and, if needed, replace) a torrent that was
   * added previously with a different file selected via `&so`.
   */
  async findByHash(hash: string): Promise<TorboxTorrent | undefined> {
    const h = hash.toLowerCase();
    const list = await this.myList();
    return list.find((t) => (t.hash ?? "").toLowerCase() === h);
  }

  /**
   * Request a short-lived (~3h) direct download URL for a file within a torrent.
   * Uses the API key as the `token` query param per TorBox's spec.
   */
  async requestDownloadLink(torrentId: number, fileId: number): Promise<string> {
    const qs = new URLSearchParams({
      token: this.apiKey,
      torrent_id: String(torrentId),
      file_id: String(fileId),
    });
    const url = await this.req<string>(`${TORBOX_PATHS.requestDl}?${qs.toString()}`);
    return url;
  }

  async deleteTorrent(torrentId: number): Promise<void> {
    await this.req(TORBOX_PATHS.controlTorrent, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ torrent_id: torrentId, operation: "delete" }),
    });
  }
}

function normalizeSearchResult(row: unknown): TorboxSearchResult | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const hash = (r.hash ?? r.info_hash) as string | undefined;
  const magnet = (r.magnet ?? r.magnet_link) as string | undefined;
  if (!hash && !magnet) return null;
  return {
    title: String(r.title ?? r.name ?? "Unknown release"),
    hash: String(hash ?? ""),
    magnet: magnet ? String(magnet) : undefined,
    seeders: numOrUndef(r.seeders ?? r.seeds ?? (r as any).last_known_seeders),
    size: numOrUndef(r.size),
    cached: Boolean(r.cached ?? (r as any).cached_torrent ?? false),
    raw: row,
  };
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
