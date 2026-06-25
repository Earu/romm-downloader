"use client";

import type { SVGProps } from "react";
import { useCallback, useEffect, useState } from "react";
import { IconDatabase, IconLink, IconServer } from "@/components/icons";

interface ServiceHealth {
  configured: boolean;
  ok: boolean;
  detail?: string;
}
interface Health {
  romm: ServiceHealth;
  debrid: ServiceHealth;
  igdb: ServiceHealth;
}
interface SettingsView {
  rommUrl: string;
  rommToken: string;
  debridProvider: string;
  debridApiKey: string;
  maxDebridGb: number;
  igdbClientId: string;
  igdbClientSecret: string;
  downloadTmpDir: string;
}

const DEBRID_OPTIONS = [
  { id: "none", label: "None (built-in torrent)" },
  { id: "torbox", label: "TorBox" },
  { id: "realdebrid", label: "Real-Debrid" },
  { id: "alldebrid", label: "AllDebrid" },
  { id: "premiumize", label: "Premiumize" },
];
interface MinervaStatus {
  syncing: boolean;
  phase?: "index" | "db";
  progress?: number;
  indexSyncedAt?: string;
  dbSyncedAt?: string;
  dbBytes?: number;
  error?: string;
  stale: boolean;
}

type SectionId = "services" | "connections" | "index";

const SECTIONS: {
  id: SectionId;
  Icon: (props: SVGProps<SVGSVGElement>) => React.ReactElement;
  label: string;
}[] = [
  { id: "services", Icon: IconServer, label: "Services" },
  { id: "connections", Icon: IconLink, label: "Connections" },
  { id: "index", Icon: IconDatabase, label: "ROM Index" },
];

/** A label-left / control-right setting row (Steam settings list style). */
function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 bg-steam-row px-4 py-3 transition hover:bg-steam-hover">
      <div className="min-w-0">
        <p className="text-sm text-steam-text">{label}</p>
        {desc && <p className="mt-0.5 text-xs text-steam-muted">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-steam-muted first:mt-0">
      {children}
    </h2>
  );
}

function StatusBadge({ s }: { s: ServiceHealth }) {
  const color = !s.configured
    ? "text-steam-muted"
    : s.ok
      ? "text-steam-green-light"
      : "text-red-400";
  const dot = !s.configured ? "bg-steam-muted" : s.ok ? "bg-steam-green-light" : "bg-red-400";
  const label = !s.configured ? "not configured" : s.ok ? "connected" : "error";
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${color}`}>
      <span className={`h-2 w-2 ${dot}`} />
      {label}
    </span>
  );
}

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>("services");
  const [health, setHealth] = useState<Health | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [minerva, setMinerva] = useState<MinervaStatus | null>(null);

  const loadHealth = useCallback(async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setHealth(await res.json());
    } finally {
      setTesting(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const data: SettingsView = await res.json();
    setForm({
      debridProvider: data.debridProvider || "none",
      debridApiKey: data.debridApiKey,
      maxDebridGb: String(data.maxDebridGb ?? 30),
      igdbClientId: data.igdbClientId,
      igdbClientSecret: data.igdbClientSecret,
      downloadTmpDir: data.downloadTmpDir,
    });
  }, []);

  const loadMinerva = useCallback(async () => {
    const res = await fetch("/api/minerva/status", { cache: "no-store" });
    setMinerva(await res.json());
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadHealth();
  }, [loadSettings, loadHealth]);

  useEffect(() => {
    if (section !== "index") return;
    void loadMinerva();
    const t = setInterval(loadMinerva, 2000);
    return () => clearInterval(t);
  }, [section, loadMinerva]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "")),
        ),
      });
      await loadSettings();
      await loadHealth();
    } finally {
      setSaving(false);
    }
  };

  const syncMinerva = async () => {
    await fetch("/api/minerva/status", { method: "POST" });
    void loadMinerva();
  };

  const input = (key: string, placeholder = "", type = "text") => (
    <input
      type={type}
      value={form[key] ?? ""}
      placeholder={placeholder}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      className="steam-input w-72"
    />
  );

  const gb = (b?: number) => (b ? `${(b / 1e9).toFixed(2)} GB` : "—");
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "never");

  return (
    <div className="grid min-h-[calc(100vh-56px)] grid-cols-[240px_1fr]">
      {/* Sidebar */}
      <aside className="border-r border-black/40 bg-steam-navy py-4">
        {SECTIONS.map((s) => {
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={
                "flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition " +
                (active
                  ? "bg-steam-blue/15 font-semibold text-steam-bright shadow-[inset_3px_0_0_var(--color-steam-blue)]"
                  : "text-steam-text hover:bg-white/[0.04]")
              }
            >
              <s.Icon className="h-[18px] w-[18px] opacity-90" />
              {s.label}
            </button>
          );
        })}
      </aside>

      {/* Content */}
      <div className="px-8 py-6">
        {section === "services" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-xl font-bold text-steam-bright">Services</h1>
              <button onClick={loadHealth} disabled={testing} className="steam-btn">
                {testing ? "Testing…" : "Test connections"}
              </button>
            </div>
            <GroupTitle>Connectivity</GroupTitle>
            <div className="space-y-1">
              {(["romm", "debrid", "igdb"] as const).map((k) => (
                <Row
                  key={k}
                  label={k === "igdb" ? "IGDB" : k === "romm" ? "RomM" : "Debrid"}
                  desc={health?.[k]?.detail || undefined}
                >
                  {health ? (
                    <StatusBadge s={health[k]} />
                  ) : (
                    <span className="text-xs text-steam-muted">…</span>
                  )}
                </Row>
              ))}
            </div>
          </div>
        )}

        {section === "connections" && (
          <div>
            <h1 className="mb-1 text-xl font-bold text-steam-bright">Connections</h1>
            <p className="mb-4 text-xs text-steam-muted">
              Values here override environment variables. Leave secret fields blank to keep the
              current value (shown masked).
            </p>

            <GroupTitle>Debrid provider</GroupTitle>
            <div className="space-y-1">
              <Row label="Provider" desc="Which debrid service to use, if any.">
                <select
                  value={form.debridProvider ?? "none"}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, debridProvider: e.target.value }))
                  }
                  className="steam-input w-72"
                >
                  {DEBRID_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id} className="bg-steam-slate">
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              {(form.debridProvider ?? "none") !== "none" && (
                <>
                  <Row label="API Key">
                    {input("debridApiKey", "", "password")}
                  </Row>
                  <Row
                    label="Max size (GB)"
                    desc="Files larger than this skip the debrid provider and offer the built-in torrent client."
                  >
                    {input("maxDebridGb", "30", "number")}
                  </Row>
                </>
              )}
            </div>

            <GroupTitle>IGDB (catalog metadata)</GroupTitle>
            <div className="space-y-1">
              <Row label="Client ID">{input("igdbClientId", "")}</Row>
              <Row label="Client Secret">
                {input("igdbClientSecret", "", "password")}
              </Row>
            </div>

            <GroupTitle>Storage</GroupTitle>
            <div className="space-y-1">
              <Row label="Download temp dir">{input("downloadTmpDir", "./data/downloads")}</Row>
            </div>

            <div className="mt-5">
              <button onClick={save} disabled={saving} className="steam-btn-green">
                {saving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </div>
        )}

        {section === "index" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-xl font-bold text-steam-bright">Minerva ROM Index</h1>
              <button onClick={syncMinerva} disabled={minerva?.syncing} className="steam-btn">
                {minerva?.syncing ? "Syncing…" : "Update now"}
              </button>
            </div>
            <p className="mb-4 text-xs text-steam-muted">
              Caches the Minerva search index + ~1.76 GB magnet database locally. Auto-refreshes
              about monthly; use “Update now” to refresh manually.
            </p>

            {minerva?.syncing && (
              <div className="mb-4 bg-steam-row p-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-steam-blue-light">
                  {minerva.phase === "db"
                    ? `Downloading database… ${minerva.progress}%`
                    : "Downloading index…"}
                </p>
                <div className="h-1.5 w-full overflow-hidden bg-black/50">
                  <div
                    className="h-full bg-steam-blue transition-all"
                    style={{ width: `${minerva.phase === "db" ? (minerva.progress ?? 0) : 5}%` }}
                  />
                </div>
              </div>
            )}

            <GroupTitle>Status</GroupTitle>
            <div className="space-y-1">
              <Row label="Index synced">
                <span className="text-sm text-steam-text">{when(minerva?.indexSyncedAt)}</span>
              </Row>
              <Row label="Database synced">
                <span className="text-sm text-steam-text">{when(minerva?.dbSyncedAt)}</span>
              </Row>
              <Row label="Database size">
                <span className="text-sm text-steam-text">{gb(minerva?.dbBytes)}</span>
              </Row>
            </div>

            {minerva?.stale && !minerva.syncing && (
              <p className="mt-3 text-xs text-amber-300">
                Index is missing or stale — consider updating.
              </p>
            )}
            {minerva?.error && <p className="mt-3 text-xs text-red-400">{minerva.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
