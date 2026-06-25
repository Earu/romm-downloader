import "server-only";
import { basename } from "node:path";
import {
  DebridError,
  type DebridFile,
  type DebridProvider,
  type DebridStatus,
} from "./types";

const BASE = "https://api.alldebrid.com/v4";
const AGENT = "romm-downloader";

interface AdEnvelope<T> {
  status: "success" | "error";
  data?: T;
  error?: { code: string; message: string };
}

interface AdMagnet {
  id: number;
  filename?: string;
  size?: number;
  status?: string;
  statusCode?: number; // 4 = Ready
  downloaded?: number;
  links?: { link: string; filename: string; size: number }[];
}

/**
 * AllDebrid (api.alldebrid.com/v4). Note: AllDebrid downloads ALL files of a
 * magnet (no partial selection), so a large bundle torrent downloads in full.
 *
 * NOTE: implemented from AllDebrid's documented API; verify with a real key.
 */
export class AllDebridProvider implements DebridProvider {
  readonly id = "alldebrid" as const;
  readonly label = "AllDebrid";

  constructor(private readonly apiKey: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${BASE}${path}${sep}agent=${AGENT}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, ...(init?.headers as object) },
      cache: "no-store",
    });
    const text = await res.text();
    let json: AdEnvelope<T> | undefined;
    try {
      json = text ? (JSON.parse(text) as AdEnvelope<T>) : undefined;
    } catch {
      /* non-JSON */
    }
    if (!res.ok || json?.status === "error") {
      throw new DebridError(
        `AllDebrid ${path}: ${res.status} ${json?.error?.message || text.slice(0, 200)}`,
        res.status,
      );
    }
    return json?.data as T;
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
    const data = await this.req<{ magnets: { id: number; error?: unknown }[] }>(
      "/magnet/upload",
      this.form({ "magnets[]": magnetOrHash }),
    );
    const m = data.magnets?.[0];
    if (!m?.id) throw new DebridError("AllDebrid: upload returned no magnet id");
    return String(m.id);
  }

  async getStatus(id: string): Promise<DebridStatus | null> {
    const data = await this.req<{ magnets: AdMagnet | AdMagnet[] }>(`/magnet/status?id=${id}`);
    const m = Array.isArray(data.magnets) ? data.magnets[0] : data.magnets;
    if (!m) return null;
    const total = m.size ?? 0;
    return {
      ready: m.statusCode === 4,
      progress: total > 0 ? Math.min(1, (m.downloaded ?? 0) / total) : 0,
      files: (m.links ?? []).map((l) => ({
        id: l.link,
        name: basename(l.filename),
        size: l.size,
        link: l.link,
      })),
    };
  }

  async getDownloadLink(_id: string, file: DebridFile): Promise<string> {
    if (!file.link) throw new DebridError("AllDebrid: no link for file");
    const data = await this.req<{ link: string }>("/link/unlock", this.form({ link: file.link }));
    return data.link;
  }

  async remove(id: string): Promise<void> {
    await this.req(`/magnet/delete?id=${id}`).catch(() => {});
  }
}
