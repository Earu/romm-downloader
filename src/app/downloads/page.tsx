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
  debridProvider: string | null;
  state: string;
  progress: number;
  bytesDownloaded: number | null;
  bytesTotal: number | null;
  updatedAt?: number;
  error: string | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  torbox: "TorBox",
  realdebrid: "Real-Debrid",
  alldebrid: "AllDebrid",
  premiumize: "Premiumize",
};

function providerLabel(id: string | null | undefined): string {
  return (id && PROVIDER_LABELS[id]) || "debrid";
}

const STATE_LABEL: Record<string, string> = {
  requested: "Queued",
  resolving: "Resolving magnet",
  fetching: "Downloading",
  unavailable: "Needs choice",
  multi_file: "Multiple files",
  local_fetching: "Downloading (torrent)",
  http_fetching: "Downloading (Vimm)",
  uploading: "Installing",
  done: "Done",
  failed: "Failed",
};

/** State label, using the job's debrid provider name where relevant. */
function stateLabel(job: Job): string {
  const p = providerLabel(job.debridProvider);
  if (job.state === "adding") return `Adding to ${p}`;
  if (job.state === "caching") return `${p} caching`;
  return STATE_LABEL[job.state] ?? job.state;
}

const ACTIVE_STATES = new Set([
  "resolving",
  "adding",
  "caching",
  "fetching",
  "local_fetching",
  "http_fetching",
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

/** Drop a trailing file extension for display (e.g. ".iso"/".gba"/".7z"), but
 *  leave version-y dots like "Game 1.5" alone (extension must contain a letter). */
function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, (m) => (/[a-z]/i.test(m) ? "" : m));
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
  else if (s === "caching" || s === "fetching" || s === "local_fetching" || s === "http_fetching")
    dl = job.progress;
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
              {stateLabel(job)}
            </p>
            <h2 className="truncate text-3xl font-bold text-steam-bright">{stripExt(job.title)}</h2>
            <p className="mt-0.5 truncate text-xs text-steam-muted">
              → {job.targetPlatformSlug}
              {job.releaseName ? ` · ${stripExt(job.releaseName)}` : ""}
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

function QueueRow({
  job,
  onChange,
  onPickVimm,
}: {
  job: Job;
  onChange: () => void;
  onPickVimm?: (id: string) => void;
}) {
  const terminal = job.state === "done" || job.state === "failed";
  // Anything not actively transferring can be removed — including a job wedged in
  // "Queued" — so a stuck queue is always clearable. (Active states would orphan
  // an in-flight download, so they keep no remove button.)
  const removable = !ACTIVE_STATES.has(job.state);
  const stateColor =
    job.state === "done"
      ? "text-steam-green-light"
      : job.state === "failed"
        ? "text-red-400"
        : job.state === "unavailable" || job.state === "multi_file"
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
        <p className="truncate text-base font-bold text-steam-bright">{stripExt(job.title)}</p>
        <p className="truncate text-sm text-steam-muted">
          {fmtSize(job.bytesTotal)}
          {job.releaseName ? ` · ${stripExt(job.releaseName)}` : ""}
        </p>
        {job.error && <p className="truncate text-sm text-red-400">{job.error}</p>}
      </div>
      {!terminal && (
        <span className={`shrink-0 text-sm font-semibold uppercase tracking-wide ${stateColor}`}>
          {STATE_LABEL[job.state] ?? job.state}
        </span>
      )}
      <div className="flex shrink-0 gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        {job.state === "failed" && onPickVimm && (
          <button
            onClick={() => onPickVimm(job.id)}
            title="Try Vimm's Lair"
            aria-label="Try Vimm's Lair"
            className="flex h-10 w-10 items-center justify-center text-steam-muted transition hover:bg-white/10 hover:text-steam-bright"
          >
            <IconDownload className="h-5 w-5" />
          </button>
        )}
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
        {removable && (
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
function FallbackModal({
  job,
  onChange,
  onPickVimm,
}: {
  job: Job;
  onChange: () => void;
  onPickVimm: () => void;
}) {
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

  // A dead/failed torrent (vs. a debrid provider that just couldn't serve a
  // bundle) — the built-in torrent already failed, so don't offer it again.
  const deadTorrent = /dead torrent|seeders|peers|aria2|stopped/i.test(job.error || "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-black/50 bg-steam-deep shadow-[0_12px_50px_rgba(0,0,0,0.7)]">
        <div className="border-b border-steam-line px-6 py-4">
          <h2 className="text-lg font-bold text-steam-bright">
            {deadTorrent
              ? "This torrent is dead"
              : `${providerLabel(job.debridProvider)} can't fetch this game`}
          </h2>
          <p className="mt-0.5 truncate text-sm text-steam-muted">{stripExt(job.title)}</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-steam-text">
            {job.error ||
              `${providerLabel(job.debridProvider)} doesn't have this file for the bundle torrent.`}{" "}
            {deadTorrent
              ? "Try a reliable direct download from Vimm's Lair, or grab the magnet to download it yourself."
              : "You can fetch just this file with the built-in torrent client, or grab the magnet and download it yourself."}
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
            <button onClick={onPickVimm} className="steam-btn-green w-full justify-center">
              <IconDownload className="h-4 w-4" />
              Try Vimm's Lair (choose a version)
            </button>
            {!deadTorrent && (
              <button onClick={useLocal} className="steam-btn w-full justify-center">
                <IconDownload className="h-4 w-4" />
                Download with built-in torrent
              </button>
            )}
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

/**
 * Lets the user choose which version of a game to grab from Vimm's Lair (the
 * different regions/revisions), then downloads that one directly over HTTP.
 */
function VimmModal({
  job,
  onChange,
  onClose,
}: {
  job: Job;
  onChange: () => void;
  onClose: () => void;
}) {
  const [cands, setCands] = useState<
    { vaultId: string; title: string; region?: string; extras?: string[]; version?: string }[] | null
  >(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/downloads/${job.id}/vimm`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setCands(d.candidates ?? []))
      .catch(() => live && setCands([]));
    return () => {
      live = false;
    };
  }, [job.id]);

  const pick = async (vaultId: string) => {
    setBusy(true);
    await api(job.id, "POST", { action: "vimm", vaultId });
    onChange();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-black/50 bg-steam-deep shadow-[0_12px_50px_rgba(0,0,0,0.7)]">
        <div className="border-b border-steam-line px-6 py-4">
          <h2 className="text-lg font-bold text-steam-bright">Choose a version on Vimm&apos;s Lair</h2>
          <p className="mt-0.5 truncate text-sm text-steam-muted">{stripExt(job.title)}</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="max-h-72 overflow-y-auto border border-black/50 bg-black/20">
            {cands === null ? (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-steam-blue-light">
                <Spinner className="h-3.5 w-3.5" /> Searching Vimm&apos;s Lair…
              </p>
            ) : cands.length === 0 ? (
              <p className="px-3 py-3 text-xs text-steam-muted">
                No match found on Vimm&apos;s Lair for this game/platform.
              </p>
            ) : (
              cands.map((c) => (
                <button
                  key={c.vaultId}
                  disabled={busy}
                  onClick={() => pick(c.vaultId)}
                  className="flex w-full items-center gap-2 border-b border-steam-line px-3 py-2 text-left text-xs text-steam-muted transition last:border-b-0 hover:bg-steam-blue/20 hover:text-steam-text disabled:opacity-50"
                  title={[c.title, c.version && `v${c.version}`, ...(c.extras ?? [])]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  <span className="truncate">{c.title}</span>
                  {c.extras?.map((x) => (
                    <span
                      key={x}
                      className="shrink-0 bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase text-amber-300"
                    >
                      {x}
                    </span>
                  ))}
                  {c.version && c.version !== "1.0" && (
                    <span className="shrink-0 bg-black/40 px-1.5 py-0.5 text-[10px] text-steam-muted">
                      v{c.version}
                    </span>
                  )}
                  {c.region && (
                    <span className="ml-auto shrink-0 bg-black/40 px-2 py-0.5 text-[10px] uppercase text-steam-blue-light">
                      {c.region}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm font-medium text-steam-muted transition hover:text-steam-text"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown when a download has several files (base game + updates + DLC) but the app
 * doesn't share RomM's library on disk — so RomM can't be given a folder to group
 * them. The user picks one file to add, or configures ROMM_LIBRARY_PATH.
 */
function MultiFileModal({ job, onChange }: { job: Job; onChange: () => void }) {
  const [files, setFiles] = useState<{ id: string; name: string; size: number }[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/downloads/${job.id}/files`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setFiles(d.files ?? []))
      .catch(() => live && setFiles([]));
    return () => {
      live = false;
    };
  }, [job.id]);

  const pick = async (fileId: string) => {
    setBusy(true);
    await api(job.id, "POST", { action: "pick", fileId });
    onChange();
  };
  const discard = async () => {
    await api(job.id, "DELETE");
    onChange();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-black/50 bg-steam-deep shadow-[0_12px_50px_rgba(0,0,0,0.7)]">
        <div className="border-b border-steam-line px-6 py-4">
          <h2 className="text-lg font-bold text-steam-bright">This download has multiple files</h2>
          <p className="mt-0.5 truncate text-sm text-steam-muted">{stripExt(job.title)}</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-steam-text">
            It contains several files (e.g. base game + updates + DLC). RomM can&apos;t be given
            them as one game over the network. Pick a single file to add, or set{" "}
            <span className="font-mono text-steam-bright">ROMM_LIBRARY_PATH</span> so the app can
            group them into one library entry.
          </p>

          <div className="max-h-64 overflow-y-auto border border-black/50 bg-black/20">
            {files === null ? (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-steam-blue-light">
                <Spinner className="h-3.5 w-3.5" /> Loading files…
              </p>
            ) : files.length === 0 ? (
              <p className="px-3 py-3 text-xs text-steam-muted">No files found.</p>
            ) : (
              files.map((f) => (
                <button
                  key={f.id}
                  disabled={busy}
                  onClick={() => pick(f.id)}
                  className="flex w-full items-center gap-2 border-b border-steam-line px-3 py-2 text-left text-xs text-steam-muted transition last:border-b-0 hover:bg-steam-blue/20 hover:text-steam-text disabled:opacity-50"
                  title={f.name}
                >
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-steam-muted/70">
                    {fmtSize(f.size)}
                  </span>
                </button>
              ))
            )}
          </div>

          <button
            onClick={discard}
            className="w-full px-4 py-2 text-sm font-medium text-steam-muted transition hover:text-steam-text"
          >
            Discard
          </button>
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
  const [vimmJobId, setVimmJobId] = useState<string | null>(null);
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
  const multiFile = jobs.find((j) => j.state === "multi_file");
  const vimmJob = vimmJobId ? jobs.find((j) => j.id === vimmJobId) : undefined;

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
      {vimmJob && (
        <VimmModal job={vimmJob} onChange={load} onClose={() => setVimmJobId(null)} />
      )}
      {!vimmJob && unavailable && (
        <FallbackModal
          job={unavailable}
          onChange={load}
          onPickVimm={() => setVimmJobId(unavailable.id)}
        />
      )}
      {!vimmJob && !unavailable && multiFile && (
        <MultiFileModal job={multiFile} onChange={load} />
      )}
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
              <QueueRow key={j.id} job={j} onChange={load} onPickVimm={setVimmJobId} />
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
                <QueueRow key={j.id} job={j} onChange={load} onPickVimm={setVimmJobId} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
