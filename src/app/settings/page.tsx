"use client";

import type { SVGProps } from "react";
import { useCallback, useEffect, useState } from "react";
import { IconDatabase, IconDrive, IconLink, IconServer, Spinner } from "@/components/icons";

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
  disabledSources: string[];
  firmwareAutoInstall: boolean;
}

const DEBRID_OPTIONS = [
  { id: "none", label: "None (built-in torrent)" },
  { id: "torbox", label: "TorBox" },
  { id: "realdebrid", label: "Real-Debrid" },
  { id: "alldebrid", label: "AllDebrid" },
  { id: "premiumize", label: "Premiumize" },
];
// Mirrors SOURCE_PROVIDERS in lib/sources (kept inline — that module is server-only).
const SOURCE_OPTIONS = [
  { id: "minerva", label: "Minerva" },
  { id: "vimm", label: "Vimm's Lair" },
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

interface FirmwareStatus {
  sources: {
    id: string;
    label: string;
    syncing: boolean;
    progress?: number;
    ready: boolean;
    version?: string;
    sizeBytes?: number;
    syncedAt?: string;
    stale: boolean;
    error?: string;
  }[];
  installing?: boolean;
  summary?: {
    ranAt: string;
    platforms: {
      slug: string;
      name: string;
      state: "ok" | "unknown" | "ko";
      present: number;
      total: number;
      needsFirmware: boolean;
    }[];
    error?: string;
  };
}

const FW_STATE: Record<string, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-steam-green-light/15 text-steam-green-light" },
  unknown: { label: "Unknown", cls: "bg-amber-500/15 text-amber-300" },
  ko: { label: "Missing", cls: "bg-red-500/15 text-red-400" },
};

type SectionId = "services" | "connections" | "index" | "firmware";

const SECTIONS: {
  id: SectionId;
  Icon: (props: SVGProps<SVGSVGElement>) => React.ReactElement;
  label: string;
}[] = [
  { id: "services", Icon: IconServer, label: "Services" },
  { id: "connections", Icon: IconLink, label: "Connections" },
  { id: "index", Icon: IconDatabase, label: "ROM Index" },
  { id: "firmware", Icon: IconDrive, label: "Firmware" },
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

/** Sliding on/off switch (the app's toggle convention). */
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
        checked ? "bg-steam-blue" : "bg-black/50"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
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
  const [disabledSources, setDisabledSources] = useState<string[]>([]);
  const [firmwareAutoInstall, setFirmwareAutoInstall] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // /api/settings is admin-only; non-admins get 403 and see a read-only notice.
  const [canEditSettings, setCanEditSettings] = useState(true);
  const [minerva, setMinerva] = useState<MinervaStatus | null>(null);
  const [firmware, setFirmware] = useState<FirmwareStatus | null>(null);
  const [firmwareBusy, setFirmwareBusy] = useState(false);

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
    if (res.status === 401 || res.status === 403) {
      setCanEditSettings(false);
      return;
    }
    const data: SettingsView = await res.json();
    setForm({
      debridProvider: data.debridProvider || "none",
      debridApiKey: data.debridApiKey,
      maxDebridGb: String(data.maxDebridGb ?? 30),
      igdbClientId: data.igdbClientId,
      igdbClientSecret: data.igdbClientSecret,
      downloadTmpDir: data.downloadTmpDir,
    });
    setDisabledSources(data.disabledSources ?? []);
    setFirmwareAutoInstall(data.firmwareAutoInstall ?? true);
  }, []);

  const loadMinerva = useCallback(async () => {
    const res = await fetch("/api/minerva/status", { cache: "no-store" });
    setMinerva(await res.json());
  }, []);

  const loadFirmware = useCallback(async () => {
    const res = await fetch("/api/firmware/status", { cache: "no-store" });
    setFirmware(await res.json());
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

  useEffect(() => {
    if (section !== "firmware") return;
    void loadFirmware();
    const t = setInterval(loadFirmware, 2000);
    return () => clearInterval(t);
  }, [section, loadFirmware]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "")),
          disabledSources,
          firmwareAutoInstall,
        }),
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

  const syncFirmware = async () => {
    // Optimistic feedback: show "working" immediately, then let the server's
    // `installing` flag (and any source download progress) carry it from there.
    setFirmwareBusy(true);
    try {
      await fetch("/api/firmware/status", { method: "POST" });
      await loadFirmware();
    } finally {
      setFirmwareBusy(false);
    }
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

  // Firmware "is something happening" state: optimistic local flag OR a running
  // install pass OR a source still downloading its pack.
  const fwDownloading = firmware?.sources.some((s) => s.syncing) ?? false;
  const fwWorking = firmwareBusy || (firmware?.installing ?? false) || fwDownloading;

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
              Leave secret fields blank to keep the current value.
            </p>

            {!canEditSettings && (
              <div className="mb-4 bg-steam-row px-4 py-3 text-xs text-amber-300">
                Connection settings are managed by an administrator and can only be viewed or
                changed by a RomM admin account.
              </div>
            )}

            <GroupTitle>ROM sources</GroupTitle>
            <div className="space-y-1">
              {SOURCE_OPTIONS.map((s) => {
                const enabled = !disabledSources.includes(s.id);
                return (
                  <Row key={s.id} label={s.label}>
                    <Toggle
                      checked={enabled}
                      onChange={(on) =>
                        setDisabledSources((d) =>
                          on ? d.filter((id) => id !== s.id) : [...d, s.id],
                        )
                      }
                    />
                  </Row>
                );
              })}
            </div>

            <GroupTitle>Debrid provider</GroupTitle>
            <div className="space-y-1">
              <Row label="Provider" desc="Optional service to download torrents.">
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
                    desc="Larger files use the built-in torrent client instead."
                  >
                    {input("maxDebridGb", "30", "number")}
                  </Row>
                </>
              )}
            </div>

            <GroupTitle>Catalog metadata</GroupTitle>
            <div className="space-y-1">
              <Row label="Client ID">{input("igdbClientId", "")}</Row>
              <Row label="Client Secret">
                {input("igdbClientSecret", "", "password")}
              </Row>
            </div>

            <GroupTitle>Storage</GroupTitle>
            <div className="space-y-1">
              <Row label="Download folder">{input("downloadTmpDir", "./data/downloads")}</Row>
            </div>

            <div className="mt-5">
              <button
                onClick={save}
                disabled={saving || !canEditSettings}
                className="steam-btn-green"
              >
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
              Local copy of the Minerva ROM index. Refreshes automatically.
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

        {section === "firmware" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-xl font-bold text-steam-bright">Firmware &amp; BIOS</h1>
              <button onClick={syncFirmware} disabled={fwWorking} className="steam-btn">
                {fwWorking ? (
                  <span className="flex items-center gap-2">
                    <Spinner className="h-3.5 w-3.5" />
                    Working…
                  </span>
                ) : (
                  "Sync & install now"
                )}
              </button>
            </div>
            <p className="mb-4 text-xs text-steam-muted">
              BIOS uploaded to matching RomM platforms.
            </p>

            {fwWorking && (
              <div className="mb-4 flex items-center gap-2 bg-steam-row px-4 py-3 text-xs text-steam-blue-light">
                <Spinner className="h-3.5 w-3.5" />
                {fwDownloading ? "Downloading firmware…" : "Installing firmware to RomM…"}
              </div>
            )}

            <div className="space-y-1">
              <Row
                label="Auto-install firmware"
                desc="Automatically upload missing BIOS."
              >
                <Toggle
                  checked={firmwareAutoInstall}
                  disabled={!canEditSettings}
                  onChange={(v) => {
                    setFirmwareAutoInstall(v);
                    void fetch("/api/settings", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ firmwareAutoInstall: v }),
                    });
                  }}
                />
              </Row>
            </div>

            {firmware?.sources.map((s) => (
              <div key={s.id} className="mt-8">
                <GroupTitle>{s.label}</GroupTitle>
                {s.syncing && (
                  <div className="mb-3 bg-steam-row p-4">
                    <p className="mb-2 text-xs uppercase tracking-wide text-steam-blue-light">
                      Downloading pack… {s.progress ?? 0}%
                    </p>
                    <div className="h-1.5 w-full overflow-hidden bg-black/50">
                      <div
                        className="h-full bg-steam-blue transition-all"
                        style={{ width: `${s.progress ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <Row label="Pack status">
                    <span className="text-sm text-steam-text">
                      {s.syncing ? "Downloading…" : s.ready ? "Ready" : "Not downloaded"}
                    </span>
                  </Row>
                  <Row label="Version">
                    <span className="text-sm text-steam-text">{s.version ?? "—"}</span>
                  </Row>
                  <Row label="Size">
                    <span className="text-sm text-steam-text">{gb(s.sizeBytes)}</span>
                  </Row>
                  <Row label="Last synced">
                    <span className="text-sm text-steam-text">{when(s.syncedAt)}</span>
                  </Row>
                </div>
                {s.error && <p className="mt-2 text-xs text-red-400">{s.error}</p>}
              </div>
            ))}

            {firmware?.summary && firmware.summary.platforms.length > 0 && (
              <>
                <GroupTitle>Platforms ({when(firmware.summary.ranAt)})</GroupTitle>
                <div className="space-y-1">
                  {firmware.summary.platforms.map((p, i) => {
                    const detail =
                      p.total > 0
                        ? `${p.present}/${p.total} present`
                        : p.needsFirmware
                          ? "firmware required"
                          : "no firmware needed";
                    const st = FW_STATE[p.state] ?? FW_STATE.ok;
                    return (
                      <Row key={`${p.slug}-${i}`} label={p.name} desc={detail}>
                        <span
                          className={`px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${st.cls}`}
                        >
                          {st.label}
                        </span>
                      </Row>
                    );
                  })}
                </div>
              </>
            )}
            {firmware?.summary?.error && (
              <p className="mt-3 text-xs text-red-400">{firmware.summary.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
