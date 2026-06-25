import "server-only";
import { basename } from "node:path";
import {
  DebridError,
  type DebridFile,
  type DebridProvider,
  type DebridStatus,
} from "./types";

const BASE = "https://www.premiumize.me/api";

/**
 * Premiumize (premiumize.me). Uses the direct-download endpoint, which returns
 * file links for a cached torrent immediately; for an uncached magnet it kicks
 * off a transfer so it caches, and reports not-ready until then. The provider's
 * "transfer id" we expose IS the magnet (Premiumize keys on the source).
 *
 * NOTE: implemented from Premiumize's documented API; verify with a real key.
 */
export class PremiumizeProvider implements DebridProvider {
  readonly id = "premiumize" as const;
  readonly label = "Premiumize";

  constructor(private readonly apiKey: string) {}

  private url(path: string, params: Record<string, string> = {}): string {
    const qs = new URLSearchParams({ apikey: this.apiKey, ...params });
    return `${BASE}${path}?${qs}`;
  }

  private async post<T>(path: string, fields: Record<string, string>): Promise<T> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      cache: "no-store",
    });
    const text = await res.text();
    let json: (T & { status?: string; message?: string }) | undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON */
    }
    if (!res.ok || json?.status === "error") {
      throw new DebridError(
        `Premiumize ${path}: ${res.status} ${json?.message || text.slice(0, 200)}`,
        res.status,
      );
    }
    return json as T;
  }

  async ping(): Promise<void> {
    await this.post("/account/info", {});
  }

  // Premiumize keys on the source magnet — return it as the transfer id.
  async addMagnet(magnetOrHash: string): Promise<string> {
    const magnet = magnetOrHash.startsWith("magnet:")
      ? magnetOrHash
      : `magnet:?xt=urn:btih:${magnetOrHash}`;
    return magnet;
  }

  async getStatus(id: string): Promise<DebridStatus | null> {
    type Content = { path: string; link: string; size: number };
    const dd = await this.post<{ status: string; content?: Content[] }>("/transfer/directdl", {
      src: id,
    }).catch(() => null);

    if (dd?.status === "success" && dd.content && dd.content.length > 0) {
      return {
        ready: true,
        progress: 1,
        files: dd.content.map((c) => ({
          id: c.link,
          name: basename(c.path),
          size: c.size,
          link: c.link,
        })),
      };
    }

    // Not cached yet — start a transfer so Premiumize fetches it (idempotent by
    // source), and report not-ready.
    await this.post("/transfer/create", { src: id }).catch(() => {});
    return { ready: false, progress: 0, files: [] };
  }

  async getDownloadLink(_id: string, file: DebridFile): Promise<string> {
    if (!file.link) throw new DebridError("Premiumize: no link for file");
    return file.link; // already a direct link
  }

  async remove(): Promise<void> {
    // Best-effort: leaving the cached item in the cloud is harmless.
  }
}
