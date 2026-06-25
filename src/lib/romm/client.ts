import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { io } from "socket.io-client";
import { normalizeBaseUrl } from "@/lib/config";

/** Subset of RomM's platform schema we care about. */
export interface RommPlatform {
  id: number;
  slug: string;
  fs_slug: string;
  name: string;
  custom_name?: string;
  rom_count: number;
  url_logo?: string | null;
}

/** Subset of RomM's ROM schema we use. */
export interface RommRom {
  id: number;
  name?: string;
  fs_name?: string;
  fs_name_no_tags?: string;
  fs_name_no_ext?: string;
  fs_size_bytes?: number;
  platform_slug?: string;
  platform_display_name?: string;
  summary?: string | null;
  url_cover?: string | null;
  igdb_id?: number | null;
}

export interface RommHeartbeat {
  SYSTEM: { VERSION: string; SHOW_SETUP_WIZARD: boolean };
  METADATA_SOURCES: Record<string, boolean>;
}

export class RommError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RommError";
  }
}

// RomM caps chunks at 64MB; use a comfortable 16MB to balance request count.
const UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;

export interface RommClientOptions {
  baseUrl: string;
  token: string;
}

/**
 * Thin typed client over RomM's REST API. Auth is a Client API Token sent as a
 * Bearer header, which (verified against RomM 4.9.2) bypasses CSRF, so all reads
 * and writes work statelessly. See memory: romm-local-dev-setup.
 */
export class RommClient {
  private readonly base: string;
  private readonly token: string;

  constructor({ baseUrl, token }: RommClientOptions) {
    this.base = normalizeBaseUrl(baseUrl);
    this.token = token;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}/api${path}`, {
      ...init,
      headers: this.headers(init?.headers as Record<string, string>),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new RommError(
        `RomM ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 300)}`,
        res.status,
      );
    }
    // Some endpoints (uploads) return empty bodies.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Public, unauthenticated health probe. */
  async heartbeat(): Promise<RommHeartbeat> {
    const res = await fetch(`${this.base}/api/heartbeat`, { cache: "no-store" });
    if (!res.ok) throw new RommError(`heartbeat ${res.status}`, res.status);
    return res.json() as Promise<RommHeartbeat>;
  }

  /** Verify the token authenticates; returns the current user. */
  async me(): Promise<{ id: number; username: string; role: string }> {
    return this.req("/users/me");
  }

  async listPlatforms(): Promise<RommPlatform[]> {
    return this.req<RommPlatform[]>("/platforms");
  }

  /** Create (and metadata-resolve) a platform by its folder slug, e.g. "snes". */
  async createPlatform(fsSlug: string): Promise<RommPlatform> {
    return this.req<RommPlatform>("/platforms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fs_slug: fsSlug }),
    });
  }

  /** List all ROMs in the library (the installed games). */
  async listRoms(): Promise<RommRom[]> {
    const res = await this.req<{ items?: RommRom[] } | RommRom[]>(
      "/roms?limit=10000&order_by=name",
    );
    return Array.isArray(res) ? res : (res.items ?? []);
  }

  /** Fetch a single ROM by id. */
  async getRom(id: number): Promise<RommRom> {
    return this.req<RommRom>(`/roms/${id}`);
  }

  /** Uninstall a ROM: remove it from the RomM database AND the filesystem. */
  async deleteRom(id: number): Promise<void> {
    await this.req("/roms/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roms: [id], delete_from_fs: [id] }),
    });
  }

  /**
   * Upload a local file into a RomM platform using RomM's chunked upload
   * protocol (start -> PUT chunks -> complete). The file is written into the
   * platform folder; call {@link triggerScan} afterwards to register it.
   */
  async uploadRom(
    filePath: string,
    platformId: number,
    filename: string,
    onProgress?: (sentBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    const { size } = await stat(filePath);
    const totalChunks = Math.max(1, Math.ceil(size / UPLOAD_CHUNK_SIZE));

    const { upload_id } = await this.req<{ upload_id: string }>("/roms/upload/start", {
      method: "POST",
      headers: {
        "x-upload-platform": String(platformId),
        "x-upload-filename": filename,
        "x-upload-total-size": String(size),
        "x-upload-total-chunks": String(totalChunks),
      },
    });

    let sent = 0;
    for (let index = 0; index < totalChunks; index++) {
      const start = index * UPLOAD_CHUNK_SIZE;
      const end = Math.min(start + UPLOAD_CHUNK_SIZE, size);
      const chunk = await readChunk(filePath, start, end - 1);
      await this.req(`/roms/upload/${upload_id}`, {
        method: "PUT",
        headers: {
          "x-chunk-index": String(index),
          "Content-Type": "application/octet-stream",
          "Content-Length": String(chunk.length),
        },
        // Cast: TS's generic Uint8Array<ArrayBufferLike> doesn't structurally
        // match DOM BodyInit, but a byte view is a valid fetch body at runtime.
        body: chunk as unknown as BodyInit,
      });
      sent += chunk.length;
      onProgress?.(sent, size);
    }

    await this.req(`/roms/upload/${upload_id}/complete`, { method: "POST" });
  }

  /**
   * Trigger a library scan so RomM registers newly-uploaded files AND matches
   * metadata (cover, name, etc.) for them. Best-effort: RomM 4.9.2 exposes scan
   * only via socket.io (no REST task triggers a ROM scan). The `apis` list is the
   * set of metadata sources to use — an empty list scans files only, so we derive
   * the enabled sources from the heartbeat and pass them along.
   */
  async triggerScan(platformId?: number): Promise<boolean> {
    let apis: string[] = [];
    try {
      const hb = await this.heartbeat();
      apis = enabledMetadataSources(hb.METADATA_SOURCES);
    } catch {
      // If the heartbeat fails we still scan (files only) rather than aborting.
    }

    return new Promise<boolean>((resolve) => {
      const socket = io(this.base, {
        path: "/ws/socket.io",
        transports: ["polling"],
        timeout: 10_000,
      });
      const done = (ok: boolean) => {
        socket.disconnect();
        resolve(ok);
      };
      socket.once("connect", () => {
        socket.emit("scan", {
          platforms: platformId != null ? [platformId] : [],
          // "quick" discovers newly-added files and matches metadata for them
          // using the sources in `apis`. (Valid types: quick, complete, hashes,
          // update, unmatched, new_platforms.)
          type: "quick",
          roms_ids: [],
          apis,
        });
        // Give RomM a moment to enqueue the job, then disconnect.
        setTimeout(() => done(true), 800);
      });
      socket.once("connect_error", () => done(false));
      setTimeout(() => done(false), 12_000);
    });
  }
}

/**
 * Map RomM's heartbeat METADATA_SOURCES flags (e.g. `IGDB_API_ENABLED`) to the
 * source slugs the scan socket expects (e.g. `igdb`), keeping only enabled ones.
 */
const METADATA_SOURCE_SLUGS: Record<string, string> = {
  IGDB_API_ENABLED: "igdb",
  MOBY_API_ENABLED: "moby",
  SS_API_ENABLED: "ss",
  RA_API_ENABLED: "ra",
  STEAMGRIDDB_API_ENABLED: "sgdb",
  LAUNCHBOX_API_ENABLED: "launchbox",
  HASHEOUS_API_ENABLED: "hasheous",
  TGDB_API_ENABLED: "tgdb",
  FLASHPOINT_API_ENABLED: "flashpoint",
  PLAYMATCH_API_ENABLED: "playmatch",
  HLTB_API_ENABLED: "hltb",
  LIBRETRO_API_ENABLED: "libretro",
};

function enabledMetadataSources(sources?: Record<string, boolean>): string[] {
  if (!sources) return [];
  return Object.entries(sources)
    .filter(([key, on]) => on && key in METADATA_SOURCE_SLUGS)
    .map(([key]) => METADATA_SOURCE_SLUGS[key]);
}

function readChunk(filePath: string, start: number, end: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(filePath, { start, end })
      .on("data", (c) => chunks.push(c as Buffer))
      // Copy into a fresh ArrayBuffer-backed view so the type satisfies BodyInit.
      .on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))))
      .on("error", reject);
  });
}
