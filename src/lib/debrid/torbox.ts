import "server-only";
import {
  DebridError,
  type DebridFile,
  type DebridProvider,
  type DebridStatus,
} from "./types";

const BASE = "https://api.torbox.app/v1/api";

interface Envelope<T> {
  success: boolean;
  error?: string | null;
  detail?: string;
  data: T;
}

interface TorboxTorrent {
  id: number;
  hash?: string;
  download_finished?: boolean;
  download_present?: boolean;
  progress?: number;
  files?: { id: number; name: string; size: number }[];
}

/** TorBox (api.torbox.app). Bearer auth; download link via `token` query param. */
export class TorboxProvider implements DebridProvider {
  readonly id = "torbox" as const;
  readonly label = "TorBox";

  constructor(private readonly apiKey: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, ...(init?.headers as object) },
      cache: "no-store",
    });
    const text = await res.text();
    let json: Envelope<T> | undefined;
    try {
      json = text ? (JSON.parse(text) as Envelope<T>) : undefined;
    } catch {
      /* non-JSON */
    }
    if (!res.ok || (json && json.success === false)) {
      throw new DebridError(
        `TorBox ${path}: ${res.status} ${json?.detail || json?.error || text.slice(0, 200)}`,
        res.status,
      );
    }
    return (json ? json.data : (undefined as T)) as T;
  }

  async ping(): Promise<void> {
    await this.req("/torrents/mylist?bypass_cache=true");
  }

  async addMagnet(magnetOrHash: string): Promise<string> {
    const form = new FormData();
    if (magnetOrHash.startsWith("magnet:")) form.set("magnet", magnetOrHash);
    else if (magnetOrHash.startsWith("http")) {
      const res = await fetch(magnetOrHash, { cache: "no-store" });
      if (!res.ok) throw new DebridError(`fetch .torrent failed: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      form.set("file", new Blob([bytes], { type: "application/x-bittorrent" }), "file.torrent");
    } else form.set("hash", magnetOrHash);
    form.set("seed", "1");
    form.set("allow_zip", "false");
    const data = await this.req<{ torrent_id: number }>("/torrents/createtorrent", {
      method: "POST",
      body: form,
    });
    return String(data.torrent_id);
  }

  async getStatus(id: string): Promise<DebridStatus | null> {
    const qs = new URLSearchParams({ bypass_cache: "true", id });
    const data = await this.req<TorboxTorrent[] | TorboxTorrent>(`/torrents/mylist?${qs}`);
    const t = Array.isArray(data) ? data[0] : data;
    if (!t) return null;
    return {
      ready: Boolean(t.download_finished || t.download_present),
      progress: t.progress ?? 0,
      files: (t.files ?? []).map((f) => ({ id: String(f.id), name: f.name, size: f.size })),
    };
  }

  async getDownloadLink(id: string, file: DebridFile): Promise<string> {
    const qs = new URLSearchParams({ token: this.apiKey, torrent_id: id, file_id: file.id });
    return this.req<string>(`/torrents/requestdl?${qs}`);
  }

  async remove(id: string): Promise<void> {
    await this.req("/torrents/controltorrent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ torrent_id: Number(id), operation: "delete" }),
    }).catch(() => {});
  }
}
