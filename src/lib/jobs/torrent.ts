import "server-only";
import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface TorrentDownloadResult {
  /** Absolute path to the downloaded file on disk. */
  path: string;
  /** Basename of the downloaded file. */
  name: string;
  /** File size in bytes. */
  bytes: number;
}

export type TorrentProgress = (downloaded: number, total: number) => void;

/** Thrown when the swarm is dead — nothing ever connected and no bytes arrived. */
export class TorrentDeadError extends Error {}

// aria2c binary — overridable if it isn't on PATH.
const ARIA2C = process.env.ARIA2C_PATH || "aria2c";

// Track in-flight downloads (exposed for the worker's status/guard).
let activeDownloads = 0;
export function hasActiveTorrentDownload(): boolean {
  return activeDownloads > 0;
}

const UNIT: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

// aria2 progress summary, e.g. "[#2089b0 612MiB/1.0GiB(59%) CN:30 SD:2 DL:5.0MiB ETA:1m]"
const PROGRESS_RE =
  /([\d.]+)(B|KiB|MiB|GiB|TiB)\/([\d.]+)(B|KiB|MiB|GiB|TiB)\((\d+)%\)/;
// aria2 prints this when a file finishes: "Download complete: /path/to/file"
const COMPLETE_RE = /Download complete:\s*(.+?)\s*$/;
// Peer/seeder counts in the progress summary, e.g. "CN:30 SD:2".
const PEERS_RE = /CN:(\d+)\s+SD:(\d+)/;

function toBytes(num: string, unit: string): number {
  return Math.round(parseFloat(num) * (UNIT[unit] ?? 1));
}

/** Turn a non-zero aria2 exit into a message that explains what actually went wrong. */
function describeAriaFailure(code: number | null, downloaded: number, maxConns: number): string {
  // Exit 7 = aria2 stopped with the download unfinished (here: --bt-stop-timeout
  // fired). If nothing ever connected or downloaded, the swarm is dead.
  if (downloaded === 0 && maxConns === 0) return "Dead torrent — no seeders or peers found.";
  if (code === 7) {
    return downloaded === 0
      ? "Stopped — no data from peers."
      : `Stopped at ${(downloaded / 1024 ** 3).toFixed(1)} GB — peers dropped.`;
  }
  const hint =
    code === 2 ? "timed out" :
    code === 3 || code === 4 ? "file not found" :
    code === 5 ? "too slow" :
    code === 6 ? "network error" :
    "error";
  return `aria2: ${hint} (exit ${code})`;
}

/** Recursively find a file by basename under `dir`. */
async function findFile(dir: string, name: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    } else if (e.name === name) {
      return full;
    }
  }
  return null;
}

/** Recursively find the largest file under `dir` (ignoring aria2's control/source files). */
async function findLargestFile(dir: string): Promise<string | null> {
  let best: { path: string; size: number } | null = null;
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (!e.name.startsWith(".") && !e.name.endsWith(".aria2")) {
        const { size } = await stat(full).catch(() => ({ size: 0 }));
        if (!best || size > best.size) best = { path: full, size };
      }
    }
  };
  await walk(dir);
  return best ? (best as { path: string }).path : null;
}

/**
 * Download a single file out of a (possibly huge multi-file) torrent using
 * aria2c's `--select-file`, which fetches only that file's pieces (including the
 * shared boundary pieces) and verifies integrity — something WebTorrent's
 * selective download couldn't finish reliably.
 *
 * `source` is the `.torrent` contents (Buffer) or a magnet/URI/path. `soId` is
 * the 0-based BitTorrent file index from Minerva (aria2 is 1-based).
 */
export function downloadSelectedFile(
  source: string | Buffer,
  soId: number | null | undefined,
  releaseName: string | null | undefined,
  destDir: string,
  onProgress: TorrentProgress,
): Promise<TorrentDownloadResult> {
  return new Promise<TorrentDownloadResult>((resolve, reject) => {
    activeDownloads++;
    let settled = false;
    let tmpTorrent: string | null = null;
    let completePath: string | null = null;

    const finish = async (err: Error | null, result?: TorrentDownloadResult) => {
      if (settled) return;
      settled = true;
      if (tmpTorrent) await rm(tmpTorrent, { force: true }).catch(() => {});
      activeDownloads = Math.max(0, activeDownloads - 1);
      if (err) reject(err);
      else resolve(result!);
    };

    void (async () => {
      await mkdir(destDir, { recursive: true });

      // aria2 needs the torrent as a file path or URI; write the buffer out.
      let torrentArg: string;
      if (Buffer.isBuffer(source)) {
        tmpTorrent = join(destDir, ".source.torrent");
        await writeFile(tmpTorrent, source);
        torrentArg = tmpTorrent;
      } else {
        torrentArg = source;
      }

      const fileIndex = (soId ?? 0) + 1; // aria2 file index is 1-based
      const args = [
        torrentArg,
        `--dir=${destDir}`,
        `--select-file=${fileIndex}`,
        "--seed-time=0", // don't seed after the file is done — exit
        "--bt-stop-timeout=120", // give up if speed stays 0 for 120s (no peers)
        "--summary-interval=1",
        "--console-log-level=warn",
        "--file-allocation=none", // avoid pre-allocating neighbour boundary files
        "--bt-max-peers=80",
        "--max-connection-per-server=16",
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
      ];

      const proc = spawn(ARIA2C, args, { stdio: ["ignore", "pipe", "pipe"] });
      let lastDownloaded = 0;
      let maxConns = 0;

      proc.on("error", (e: NodeJS.ErrnoException) => {
        void finish(
          e.code === "ENOENT"
            ? new Error(
                "aria2c not found — install aria2 (Windows: winget install aria2.aria2; " +
                  "Alpine: apk add aria2) or set ARIA2C_PATH.",
              )
            : e,
        );
      });

      const handleLine = (line: string) => {
        const p = PROGRESS_RE.exec(line);
        if (p) {
          lastDownloaded = toBytes(p[1], p[2]);
          onProgress(lastDownloaded, toBytes(p[3], p[4]));
        }
        const peers = PEERS_RE.exec(line);
        if (peers) maxConns = Math.max(maxConns, Number(peers[1]));
        const c = COMPLETE_RE.exec(line);
        if (c && !c[1].endsWith(".source.torrent")) completePath = c[1].trim();
      };
      // aria2 updates progress in-place with carriage returns, so split on both
      // \r and \n rather than relying on newline-only line reading.
      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString();
        const parts = buf.split(/\r\n|\r|\n/);
        buf = parts.pop() ?? "";
        for (const line of parts) handleLine(line);
      };
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      proc.on("close", async (code) => {
        if (settled) return;
        if (code !== 0) {
          const msg = describeAriaFailure(code, lastDownloaded, maxConns);
          // Nothing ever connected and no bytes arrived: the swarm is dead, not
          // merely slow — surface that so the caller can record it.
          const dead = lastDownloaded === 0 && maxConns === 0;
          await finish(dead ? new TorrentDeadError(msg) : new Error(msg));
          return;
        }
        // Locate the finished file: aria2's reported path, else by release name,
        // else (manual magnet with no known name) the largest downloaded file.
        const path =
          completePath ||
          (releaseName ? await findFile(destDir, basename(releaseName)) : null) ||
          (await findLargestFile(destDir));
        if (!path) {
          await finish(new Error("aria2c finished but the downloaded file wasn't found"));
          return;
        }
        const { size } = await stat(path);
        await finish(null, { path, name: basename(path), bytes: size });
      });
    })().catch((e) => void finish(e instanceof Error ? e : new Error(String(e))));
  });
}
