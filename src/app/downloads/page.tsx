"use client";

import type { SVGProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconActivity,
  IconDownload,
  IconDrive,
  IconRetry,
  IconX,
  Spinner,
} from "@/components/icons";

interface Job {
  id: string;
  title: string;
  coverUrl: string | null;
  targetPlatformSlug: string;
  releaseName: string | null;
  magnetOrHash: string | null;
  state: string;
  progress: number;
  bytesDownloaded: number | null;
  bytesTotal: number | null;
  updatedAt?: number;
  error: string | null;
}

const STATE_LABEL: Record<string, string> = {
  requested: "Queued",
  resolving: "Resolving magnet",
  adding: "Adding to TorBox",
  caching: "TorBox caching",
  fetching: "Downloading",
  unavailable: "Needs choice",
  local_fetching: "Downloading (torrent)",
  uploading: "Installing",
  done: "Done",
  failed: "Failed",
};

const ACTIVE_STATES = new Set([
  "resolving",
  "adding",
  "caching",
  "fetching",
  "local_fetching",
  "uploading",
]);

interface SpeedStats {
  speed: number; // bytes/sec
  peak: number; // bytes/sec
  hist: number[]; // recent speed samples (bytes/sec)
  etaSec: number | null;
}

const EMPTY_STATS: SpeedStats = { speed: 0, peak: 0, hist: [], etaSec: null };

function fmtSize(b: number | null | undefined): string {
  if (b == null) return "—";
  const gb = b / 1e9;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(b / 1e6).toFixed(0)} MB`;
}

function fmtSpeed(bytesPerSec: number): string {
  const mbps = (bytesPerSec * 8) / 1e6;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  return `${mbps.toFixed(1)} Mbps`;
}

function fmtEta(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Map a job's state to the two-bar Steam metaphor (download then install). */
function phases(job: Job): { dl: number; inst: number } {
  const s = job.state;
  let dl = 0;
  let inst = 0;
  if (s === "uploading" || s === "done") dl = 100;
  else if (s === "caching" || s === "fetching" || s === "local_fetching") dl = job.progress;
  if (s === "done") inst = 100;
  else if (s === "uploading") inst = job.progress;
  return { dl, inst };
}

function api(id: string, method: "POST" | "DELETE", body?: unknown) {
  return fetch(`/api/downloads/${id}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function Stat({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: (props: SVGProps<SVGSVGElement>) => React.ReactElement;
}) {
  return (
    <div className="min-w-[110px]">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-steam-muted">
        <Icon className="h-3.5 w-3.5 text-steam-blue-light" />
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold text-steam-bright">{value}</div>
    </div>
  );
}

function SpeedGraph({ hist, peak }: { hist: number[]; peak: number }) {
  const max = Math.max(peak, ...hist, 1);
  // Pad to a fixed number of slots so the graph grows from the right like Steam.
  const slots = 40;
  const padded = [...Array(Math.max(0, slots - hist.length)).fill(0), ...hist.slice(-slots)];
  return (
    <div className="flex h-12 w-32 shrink-0 items-end gap-px">
      {padded.map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-steam-blue"
          style={{ height: `${Math.max(2, (v / max) * 100)}%`, opacity: v > 0 ? 1 : 0.25 }}
        />
      ))}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: "blue" | "green" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden bg-black/50">
      <div
        className={"h-full transition-all " + (color === "blue" ? "bg-steam-blue" : "bg-steam-green-light")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function FeaturedDownload({
  job,
  stats,
  onChange,
}: {
  job: Job;
  stats: SpeedStats;
  onChange: () => void;
}) {
  const { dl, inst } = phases(job);

  return (
    <div className="relative overflow-hidden border-b border-black/50 bg-steam-navy">
      {/* Faint cover art backdrop, fading to the right. */}
      {job.coverUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={job.coverUrl}
            alt=""
            className="pointer-events-none absolute inset-y-0 left-0 h-full w-1/2 object-cover opacity-25"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/40 via-steam-navy/85 to-steam-navy" />
        </>
      )}

      <div className="relative flex items-stretch gap-6 px-8 py-6">
        {/* Cover + title */}
        <div className="flex min-w-0 flex-1 items-end gap-4">
          <div className="h-28 w-20 shrink-0 overflow-hidden bg-black/50 shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            {job.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={job.coverUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-steam-blue-light">
              {STATE_LABEL[job.state] ?? job.state}
            </p>
            <h2 className="truncate text-3xl font-bold text-steam-bright">{job.title}</h2>
            <p className="mt-0.5 truncate text-xs text-steam-muted">
              → {job.targetPlatformSlug}
              {job.releaseName ? ` · ${job.releaseName}` : ""}
            </p>
          </div>
        </div>

        {/* Stats + bars */}
        <div className="flex w-[52%] shrink-0 flex-col justify-center">
          <div className="mb-3 flex gap-8">
            <Stat label="Network" value={fmtSpeed(stats.speed)} Icon={IconActivity} />
            <Stat label="Peak" value={fmtSpeed(stats.peak)} Icon={IconActivity} />
            <Stat label="Disk Usage" value={fmtSpeed(stats.speed)} Icon={IconDrive} />
          </div>

          <div className="flex items-end gap-4">
            <SpeedGraph hist={stats.hist} peak={stats.peak} />
            <div className="flex-1 space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-steam-text">Downloading data</span>
                  <span className="tabular-nums text-steam-muted">
                    {fmtSize(job.bytesDownloaded)} / {fmtSize(job.bytesTotal)}
                  </span>
                </div>
                <Bar pct={dl} color="blue" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-steam-text">Installing files</span>
                  <span className="tabular-nums text-steam-muted">{Math.round(inst)}%</span>
                </div>
                <Bar pct={inst} color="green" />
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-steam-muted">
              {stats.etaSec != null && job.state === "fetching"
                ? `Estimated ${fmtEta(stats.etaSec)} remaining`
                : " "}
            </span>
            <button
              onClick={async () => {
                await api(job.id, "DELETE");
                onChange();
              }}
              className="steam-btn-primary px-3 py-2"
              title="Cancel & remove"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {job.error && (
        <p className="relative border-t border-black/40 bg-red-500/10 px-8 py-2 text-xs text-red-400">
          {job.error}
        </p>
      )}
    </div>
  );
}

function QueueRow({ job, onChange }: { job: Job; onChange: () => void }) {
  const terminal = job.state === "done" || job.state === "failed";
  const stateColor =
    job.state === "done"
      ? "text-steam-green-light"
      : job.state === "failed"
        ? "text-red-400"
        : job.state === "unavailable"
          ? "text-amber-400"
          : "text-steam-blue-light";

  return (
    <div className="group flex items-center gap-4 border-b border-steam-line px-2 py-3 transition hover:bg-white/[0.03]">
      <div className="h-16 w-12 shrink-0 overflow-hidden bg-black/50">
        {job.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.coverUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-steam-bright">{job.title}</p>
        <p className="truncate text-sm text-steam-muted">
          {fmtSize(job.bytesTotal)}
          {job.releaseName ? ` · ${job.releaseName}` : ""}
        </p>
        {job.error && <p className="truncate text-sm text-red-400">{job.error}</p>}
      </div>
      {!terminal && (
        <span className={`shrink-0 text-sm font-semibold uppercase tracking-wide ${stateColor}`}>
          {STATE_LABEL[job.state] ?? job.state}
        </span>
      )}
      <div className="flex shrink-0 gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        {job.state === "failed" && (
          <button
            onClick={async () => {
              await api(job.id, "POST");
              onChange();
            }}
            title="Retry"
            aria-label="Retry"
            className="flex h-10 w-10 items-center justify-center text-steam-muted transition hover:bg-white/10 hover:text-steam-bright"
          >
            <IconRetry className="h-5 w-5" />
          </button>
        )}
        {terminal && (
          <button
            onClick={async () => {
              await api(job.id, "DELETE");
              onChange();
            }}
            title="Remove"
            aria-label="Remove"
            className="flex h-10 w-10 items-center justify-center text-steam-muted transition hover:bg-white/10 hover:text-steam-bright"
          >
            <IconX className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Shown when TorBox can't serve a file. Offers the built-in torrent client
 * (which honours `&so` and fetches just this file), copying the magnet to
 * handle it manually, or discarding the job.
 */
function FallbackModal({ job, onChange }: { job: Job; onChange: () => void }) {
  const [copied, setCopied] = useState(false);

  const useLocal = async () => {
    await api(job.id, "POST", { action: "local" });
    onChange();
  };
  const copyMagnet = async () => {
    try {
      if (job.magnetOrHash) await navigator.clipboard.writeText(job.magnetOrHash);
      setCopied(true);
    } catch {
      setCopied(true); // fall back to the visible field below
    }
    await api(job.id, "DELETE");
    setTimeout(onChange, 700);
  };
  const discard = async () => {
    await api(job.id, "DELETE");
    onChange();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-black/50 bg-steam-deep shadow-[0_12px_50px_rgba(0,0,0,0.7)]">
        <div className="border-b border-steam-line px-6 py-4">
          <h2 className="text-lg font-bold text-steam-bright">TorBox can&apos;t fetch this game</h2>
          <p className="mt-0.5 truncate text-sm text-steam-muted">{job.title}</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-steam-text">
            {job.error ||
              "TorBox doesn't have this file cached for the bundle torrent."}{" "}
            You can fetch just this file with the built-in torrent client, or grab the magnet
            and download it yourself.
          </p>

          {job.magnetOrHash && (
            <input
              readOnly
              value={job.magnetOrHash}
              onFocus={(e) => e.currentTarget.select()}
              className="steam-input w-full font-mono text-xs"
            />
          )}

          <div className="flex flex-col gap-2">
            <button onClick={useLocal} className="steam-btn-green w-full justify-center">
              <IconDownload className="h-4 w-4" />
              Download with built-in torrent
            </button>
            <button onClick={copyMagnet} className="steam-btn w-full justify-center">
              {copied ? "Copied ✓" : "Copy magnet & remove"}
            </button>
            <button
              onClick={discard}
              className="w-full px-4 py-2 text-sm font-medium text-steam-muted transition hover:text-steam-text"
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  right,
}: {
  title: string;
  count: number;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-4">
      <h3 className="shrink-0 text-base font-bold text-steam-bright">
        {title} <span className="text-steam-muted">({count})</span>
      </h3>
      <div className="h-px flex-1 bg-steam-line" />
      {right}
    </div>
  );
}

export default function DownloadsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<SpeedStats>(EMPTY_STATS);
  const trackRef = useRef<{
    id: string;
    bytes: number;
    t: number;
    peak: number;
    hist: number[];
  } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/downloads", { cache: "no-store" });
    const data = await res.json();
    setJobs(data.jobs ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const featured = jobs.find((j) => ACTIVE_STATES.has(j.state));
  const queued = jobs.filter(
    (j) => j.id !== featured?.id && j.state !== "done" && j.state !== "failed",
  );
  const history = jobs.filter((j) => j.state === "done" || j.state === "failed");
  // First job awaiting the user's fallback choice drives the modal.
  const unavailable = jobs.find((j) => j.state === "unavailable");

  // Derive live download speed / peak / ETA from successive byte readings.
  useEffect(() => {
    if (!featured) {
      trackRef.current = null;
      setStats(EMPTY_STATS);
      return;
    }
    const cur = featured.bytesDownloaded ?? 0;
    const now = Date.now();
    const prev = trackRef.current;
    if (prev && prev.id === featured.id) {
      const dt = (now - prev.t) / 1000;
      if (dt > 0.3) {
        const db = cur - prev.bytes;
        const speed = db > 0 ? db / dt : 0;
        const peak = Math.max(prev.peak, speed);
        const hist = [...prev.hist, speed].slice(-40);
        const total = featured.bytesTotal ?? 0;
        const etaSec = speed > 0 && total > cur ? (total - cur) / speed : null;
        setStats({ speed, peak, hist, etaSec });
        trackRef.current = { id: featured.id, bytes: cur, t: now, peak, hist };
      }
    } else {
      trackRef.current = { id: featured.id, bytes: cur, t: now, peak: 0, hist: [] };
      setStats(EMPTY_STATS);
    }
  }, [jobs, featured]);

  const clearAll = async () => {
    await Promise.all(history.map((j) => api(j.id, "DELETE")));
    void load();
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-28">
        <Spinner className="h-8 w-8 text-steam-muted" />
      </div>
    );
  }

  return (
    <div>
      {unavailable && <FallbackModal job={unavailable} onChange={load} />}
      {featured ? (
        <FeaturedDownload job={featured} stats={stats} onChange={load} />
      ) : (
        <div className="flex items-center gap-5 border-b border-black/50 bg-steam-navy px-8 py-10">
          <IconDownload className="h-10 w-10 text-steam-muted" />
          <div>
            <h2 className="text-xl font-bold text-steam-bright">No active downloads</h2>
            <p className="text-sm text-steam-muted">
              Pick a game from the Library and choose “Download to RomM”.
            </p>
          </div>
        </div>
      )}

      <div className="px-8 py-6">
        <SectionHeader title="Up Next" count={queued.length} />
        {queued.length === 0 ? (
          <p className="px-2 py-3 text-sm text-steam-muted">
            There are no downloads in the queue
          </p>
        ) : (
          <div>
            {queued.map((j) => (
              <QueueRow key={j.id} job={j} onChange={load} />
            ))}
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-8">
            <SectionHeader
              title="Completed"
              count={history.length}
              right={
                <button onClick={clearAll} className="steam-btn shrink-0">
                  Clear All
                </button>
              }
            />
            <div>
              {history.map((j) => (
                <QueueRow key={j.id} job={j} onChange={load} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
