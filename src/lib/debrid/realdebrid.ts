import "server-only";
import { basename } from "node:path";
import {
  type AcquireHint,
  DebridError,
  type DebridFile,
  type DebridProvider,
  type DebridStatus,
} from "./types";

const BASE = "https://api.real-debrid.com/rest/1.0";

interface RdTorrentInfo {
  status: string; // magnet_conversion | waiting_files_selection | downloading | downloaded | error | ...
  progress?: number; // 0..100
  files?: { id: number; path: string; bytes: number; selected: number }[];
  links?: string[];
}

/**
 * Real-Debrid (api.real-debrid.com). Unlike TorBox, RD requires selecting which
 * files to download before it starts, so we select the requested file (by name)
 * on the first poll — avoiding pulling an entire bundle torrent.
 *
 * NOTE: implemented from RD's documented API; verify with a real key.
 */
export class RealDebridProvider implements DebridProvider {
  readonly id = "realdebrid" as const;
  readonly label = "Real-Debrid";

  constructor(private readonly token: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init?.headers as object) },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new DebridError(`Real-Debrid ${path}: ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private form(fields: Record<string, string>): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    };
  }

  async ping(): Promise<void> {
    await this.req("/user");
  }

  async addMagnet(magnetOrHash: string): Promise<string> {
    const magnet = magnetOrHash.startsWith("magnet:")
      ? magnetOrHash
      : `magnet:?xt=urn:btih:${magnetOrHash}`;
    const data = await this.req<{ id: string }>(
      "/torrents/addMagnet",
      this.form({ magnet }),
    );
    return data.id;
  }

  async getStatus(id: string, hint: AcquireHint): Promise<DebridStatus | null> {
    const info = await this.req<RdTorrentInfo>(`/torrents/info/${id}`);
    if (!info) return null;

    // RD won't download until files are selected — select the wanted one (by
    // name) so we don't fetch the whole bundle.
    if (info.status === "waiting_files_selection") {
      const want = hint.releaseName ? basename(hint.releaseName).toLowerCase() : null;
      const match = want
        ? (info.files ?? []).find((f) => basename(f.path).toLowerCase() === want)
        : undefined;
      const files = match ? String(match.id) : "all";
      await this.req(`/torrents/selectFiles/${id}`, this.form({ files }));
      return { ready: false, progress: 0, files: [] };
    }
    if (info.status === "magnet_conversion" || info.status === "queued") {
      return { ready: false, progress: 0, files: [] };
    }

    const selected = (info.files ?? []).filter((f) => f.selected === 1);
    const links = info.links ?? [];
    const files: DebridFile[] = selected.map((f, i) => ({
      id: String(f.id),
      name: basename(f.path),
      size: f.bytes,
      link: links[i],
    }));
    return {
      ready: info.status === "downloaded",
      progress: (info.progress ?? 0) / 100,
      files,
    };
  }

  async getDownloadLink(_id: string, file: DebridFile): Promise<string> {
    if (!file.link) throw new DebridError("Real-Debrid: no link for file");
    const data = await this.req<{ download: string }>(
      "/unrestrict/link",
      this.form({ link: file.link }),
    );
    return data.download;
  }

  async remove(id: string): Promise<void> {
    await this.req(`/torrents/delete/${id}`, { method: "DELETE" }).catch(() => {});
  }
}
