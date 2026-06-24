import "server-only";
import { basename, join } from "node:path";
import WebTorrent from "webtorrent";

export interface TorrentDownloadResult {
  /** Absolute path to the downloaded file on disk. */
  path: string;
  /** Basename of the downloaded file. */
  name: string;
  /** File size in bytes. */
  bytes: number;
}

export type TorrentProgress = (downloaded: number, total: number) => void;

// Abort if metadata never arrives (dead magnet / no peers).
const METADATA_TIMEOUT_MS = 60_000;
// Abort if the chosen file makes no progress for this long.
const STALL_TIMEOUT_MS = 120_000;

/**
 * Download a single file out of a (possibly huge multi-file) torrent using the
 * BitTorrent select-only mechanism — the same selection TorBox ignores.
 *
 * We add the torrent with `deselect: true` (nothing selected) and then select
 * ONLY the target file, so just its pieces are fetched. (Do not call
 * `file.deselect()` on every file — that corrupts WebTorrent's piece picker.)
 * The target is chosen by `soId` (the BitTorrent file index from Minerva), with
 * filename / single-file fallbacks.
 */
export function downloadSelectedFile(
  magnet: string,
  soId: number | null | undefined,
  releaseName: string | null | undefined,
  destDir: string,
  onProgress: TorrentProgress,
): Promise<TorrentDownloadResult> {
  return new Promise<TorrentDownloadResult>((resolve, reject) => {
    const client = new WebTorrent();
    let settled = false;
    let lastBytes = 0;
    let lastAdvance = Date.now();
    const timers: ReturnType<typeof setInterval>[] = [];

    const cleanup = () => {
      for (const t of timers) clearInterval(t);
      client.destroy(() => {});
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const succeed = (r: TorrentDownloadResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(r);
    };

    client.on("error", (e) => fail(e instanceof Error ? e : new Error(String(e))));

    // Guard: if metadata never resolves, give up.
    const metadataTimer = setTimeout(
      () => fail(new Error("Torrent metadata not received (no peers reachable)")),
      METADATA_TIMEOUT_MS,
    );

    // `deselect` (start with nothing selected) exists in webtorrent 3.x but is
    // missing from the bundled types.
    const addOpts = { path: destDir, deselect: true } as WebTorrent.TorrentOptions;
    client.add(magnet, addOpts, (torrent) => {
      clearTimeout(metadataTimer);

      let target =
        soId != null && soId >= 0 && soId < torrent.files.length
          ? torrent.files[soId]
          : undefined;
      if (!target && releaseName) {
        const want = basename(releaseName).toLowerCase();
        target = torrent.files.find((f) => basename(f.path).toLowerCase() === want);
      }
      if (!target && torrent.files.length === 1) target = torrent.files[0];
      if (!target) {
        fail(new Error("Selected file not found in torrent"));
        return;
      }

      const chosen = target;
      chosen.select(); // download ONLY this file's pieces

      torrent.on("error", (e) => fail(e instanceof Error ? e : new Error(String(e))));

      // Safe read of live byte counts (the getters throw once destroyed).
      const read = (): number | null => {
        if (settled || (torrent as unknown as { destroyed?: boolean }).destroyed) return null;
        try {
          return chosen.downloaded;
        } catch {
          return null;
        }
      };

      timers.push(
        setInterval(() => {
          const d = read();
          if (d != null) onProgress(d, chosen.length);
        }, 1000),
      );
      timers.push(
        setInterval(() => {
          const d = read();
          if (d == null) return;
          if (d > lastBytes) {
            lastBytes = d;
            lastAdvance = Date.now();
          } else if (Date.now() - lastAdvance > STALL_TIMEOUT_MS) {
            fail(new Error("Torrent download stalled (no peers reachable)"));
          }
        }, 5000),
      );

      chosen.on("done", () => {
        onProgress(chosen.length, chosen.length);
        succeed({
          path: join(destDir, chosen.path),
          name: basename(chosen.path),
          bytes: chosen.length,
        });
      });
    });
  });
}
