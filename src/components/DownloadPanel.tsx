"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconPlay, Spinner } from "@/components/icons";
import { KNOWN_PLATFORMS, type KnownPlatform, toRommFsSlug } from "@/lib/platforms";

export interface RommPlatformOption {
  id: number;
  name: string;
  slug: string;
  fsSlug: string;
}

type SourceProviderId = "minerva" | "vimm" | "magnet";

interface SourceResult {
  provider: SourceProviderId;
  transport: "torrent" | "http";
  ref: string;
  fileName: string;
  platformSlug?: string;
  platformName?: string;
  region?: string;
  version?: string;
  extras?: string[];
  size?: number;
}

interface ProviderStatus {
  id: SourceProviderId;
  label: string;
  status: "ok" | "error" | "not-synced" | "disabled" | "skipped";
  error?: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  minerva: "Minerva",
  vimm: "Vimm's Lair",
};

interface Props {
  game: { id: string; name: string; coverUrl?: string };
  /** Platforms that already exist in RomM — used for ID lookup and presence indicator. */
  rommPlatforms: RommPlatformOption[];
  /** Suggested fs_slug based on the game's IGDB platform data. */
  suggestedSlug?: string;
  /** The game's official platforms (IGDB slugs) — search is scoped/filtered to these. */
  platformSlugs: string[];
}

function filterPlatforms(query: string): KnownPlatform[] {
  const q = query.toLowerCase().trim();
  if (!q) return KNOWN_PLATFORMS;
  return KNOWN_PLATFORMS.filter(
    (p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
  );
}

export function DownloadPanel({ game, rommPlatforms, suggestedSlug, platformSlugs }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(game.name);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [selected, setSelected] = useState<SourceResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [notSynced, setNotSynced] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Platform combobox state
  const suggested = suggestedSlug
    ? (KNOWN_PLATFORMS.find((p) => p.slug === suggestedSlug) ?? null)
    : null;
  const [selectedPlatform, setSelectedPlatform] = useState<KnownPlatform | null>(suggested);
  const [platformQuery, setPlatformQuery] = useState(suggested?.name ?? "");
  const [comboOpen, setComboOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const filteredPlatforms = filterPlatforms(platformQuery);
  const rommBySlug = new Map(rommPlatforms.map((p) => [p.fsSlug, p]));

  const [includeAll, setIncludeAll] = useState(false);
  const [manualMagnet, setManualMagnet] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "queued" | "error">("idle");
  const [message, setMessage] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const magnet = manualMagnet.trim();
  const magnetValid = /^magnet:\?.*xt=urn:btih:/i.test(magnet);

  // Close combobox on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const runSearch = useCallback(async (q: string, all: boolean, platforms: string[]) => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const params = new URLSearchParams({ q });
      if (all) params.set("all", "1");
      if (platforms.length) params.set("platforms", platforms.join(","));
      const res = await fetch(`/api/sources/search?${params}`, { cache: "no-store" });
      const data = await res.json();
      const providers: ProviderStatus[] = data.providers ?? [];
      setNotSynced(providers.some((p) => p.id === "minerva" && p.status === "not-synced"));
      setResults(data.results ?? []);
      // Surface a non-fatal provider error (e.g. a Vimm hiccup) without hiding the
      // other providers' results.
      const errored = providers.find((p) => p.status === "error" && p.error);
      setSearchError(errored ? `${errored.label}: ${errored.error}` : "");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    // Search is scoped to the game's official platforms (Vimm searches each it
    // covers; results on other platforms are dropped server-side).
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSearch(query, includeAll, platformSlugs), 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, includeAll, runSearch, platformSlugs]);

  const selectPlatform = (p: KnownPlatform) => {
    setSelectedPlatform(p);
    setPlatformQuery(p.name);
    setComboOpen(false);
  };

  // Picking a ROM result auto-selects its inferred platform in the combobox.
  const selectResult = (r: SourceResult) => {
    setSelected(r);
    setManualMagnet(""); // a chosen result and a manual magnet are mutually exclusive
    if (r.platformSlug) {
      const p = KNOWN_PLATFORMS.find((kp) => kp.slug === r.platformSlug);
      if (p) {
        setSelectedPlatform(p);
        setPlatformQuery(p.name);
      }
    }
  };

  const submit = async () => {
    // A pasted magnet takes precedence over a selected Minerva result.
    const useMagnet = magnetValid;
    if ((!useMagnet && !selected) || !selectedPlatform) return;

    const existing = rommBySlug.get(toRommFsSlug(selectedPlatform.slug));
    const platformSlug = selectedPlatform.slug;
    const platformId = existing?.id; // undefined → API will create it

    setStatus("submitting");
    setMessage("");
    try {
      const body: Record<string, unknown> = {
        title: useMagnet ? game.name : selected!.fileName,
        catalogGameId: game.id,
        coverUrl: game.coverUrl,
        platformSlug,
        sourceProvider: useMagnet ? "magnet" : selected!.provider,
        sourceRef: useMagnet ? magnet : selected!.ref,
      };
      if (platformId != null) body.platformId = platformId;

      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus("queued");
      router.push("/downloads");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const canSubmit =
    (magnetValid || !!selected) &&
    !!selectedPlatform &&
    status !== "submitting" &&
    status !== "queued";

  return (
    <div className="steam-panel space-y-3.5 p-5">
      <div>
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium uppercase tracking-wide text-steam-muted">
            Find the ROM
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-steam-muted">
            <input
              type="checkbox"
              checked={includeAll}
              onChange={(e) => setIncludeAll(e.target.checked)}
              className="accent-steam-blue"
            />
            Show non-game content
          </label>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ROM files…"
          className="steam-input mt-1.5 w-full"
        />
      </div>

      {notSynced && (
        <p className="text-sm text-amber-200">
          Minerva index isn&apos;t synced yet. Sync it in{" "}
          <Link href="/settings" className="font-medium underline">
            Settings
          </Link>{" "}
          first.
        </p>
      )}
      {searchError && <p className="text-sm text-red-400">{searchError}</p>}
      {searching && (
        <p className="flex items-center gap-2 text-xs text-steam-blue-light">
          <Spinner className="h-3.5 w-3.5" />
          Searching…
        </p>
      )}

      {results.length > 0 && (
        <div className="max-h-64 overflow-y-auto border border-black/50 bg-black/20">
          {results.map((r) => {
            const key = `${r.provider}:${r.ref}`;
            const isSelected = selected != null && selected.provider === r.provider && selected.ref === r.ref;
            return (
              <button
                key={key}
                onClick={() => selectResult(r)}
                className={`flex w-full items-center gap-2 border-b border-steam-line px-3 py-2 text-left text-xs transition last:border-b-0 ${
                  isSelected
                    ? "bg-steam-blue/25 text-steam-bright"
                    : "text-steam-muted hover:bg-white/[0.04] hover:text-steam-text"
                }`}
                title={[r.fileName, ...(r.extras ?? []), r.version && `v${r.version}`]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <span className="shrink-0 bg-steam-blue/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-steam-blue-light">
                  {PROVIDER_LABEL[r.provider] ?? r.provider}
                </span>
                <span className="shrink-0 bg-black/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-steam-muted">
                  {r.transport === "http" ? "HTTP" : "Torrent"}
                </span>
                <span className="truncate">{r.fileName}</span>
                {r.region && (
                  <span className="ml-auto shrink-0 bg-black/40 px-1.5 py-0.5 text-[10px] uppercase text-steam-muted">
                    {r.region}
                  </span>
                )}
                {r.platformName && (
                  <span
                    className={`shrink-0 bg-black/40 px-2 py-0.5 text-[10px] text-steam-blue-light ${r.region ? "" : "ml-auto"}`}
                  >
                    {r.platformName}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Manual magnet — for games Minerva doesn't have. Takes precedence. */}
      <div className="border-t border-white/5 pt-3">
        <label className="block text-xs font-medium uppercase tracking-wide text-steam-muted">
          Or paste a magnet link
        </label>
        <input
          value={manualMagnet}
          onChange={(e) => {
            setManualMagnet(e.target.value);
            if (e.target.value.trim()) setSelected(null);
          }}
          placeholder="magnet:?xt=urn:btih:…"
          className="steam-input mt-1.5 w-full font-mono text-xs"
        />
        {magnet.length > 0 && !magnetValid && (
          <p className="mt-1 text-xs text-amber-300">That doesn&apos;t look like a magnet link.</p>
        )}
        {magnetValid && (
          <p className="mt-1 text-xs text-steam-muted">
            Using this magnet — the main file is uploaded as{" "}
            <span className="text-steam-text">{game.name}</span>.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-white/5 pt-4">
        {/* Platform combobox */}
        <div className="space-y-1.5" ref={comboRef}>
          <span className="block text-xs font-medium uppercase tracking-wide text-steam-muted">
            Target RomM platform
          </span>
          <div className="relative">
            <input
              value={platformQuery}
              onChange={(e) => {
                setPlatformQuery(e.target.value);
                setSelectedPlatform(null);
                setComboOpen(true);
              }}
              onFocus={() => setComboOpen(true)}
              placeholder="Search platforms…"
              className="steam-input w-64 pr-8"
            />
            {selectedPlatform && rommBySlug.has(toRommFsSlug(selectedPlatform.slug)) && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-steam-green-light">
                ✓
              </span>
            )}
            {comboOpen && (
              <div className="absolute z-20 mt-1 max-h-56 w-64 overflow-y-auto border border-black/60 bg-steam-deep shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
                {filteredPlatforms.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-steam-muted">No platforms found</p>
                ) : (
                  filteredPlatforms.map((p) => {
                    const inRomm = rommBySlug.has(toRommFsSlug(p.slug));
                    return (
                      <button
                        key={p.slug}
                        onMouseDown={(e) => {
                          e.preventDefault(); // prevent input blur before click registers
                          selectPlatform(p);
                        }}
                        className="flex w-full items-center gap-2 border-b border-steam-line px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-steam-blue/20"
                      >
                        <span className={inRomm ? "text-steam-text" : "text-steam-muted"}>
                          {p.name}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-xs text-steam-muted/60">
                          {p.slug}
                        </span>
                        {inRomm && (
                          <span className="shrink-0 text-xs text-steam-green-light" title="Already in RomM">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          {selectedPlatform && !rommBySlug.has(toRommFsSlug(selectedPlatform.slug)) && (
            <p className="text-xs text-amber-300">Will be created in RomM on submit</p>
          )}
        </div>

        <button onClick={submit} disabled={!canSubmit} className="steam-btn-green">
          {status === "submitting" ? (
            "Queuing…"
          ) : status === "queued" ? (
            "Queued ✓"
          ) : (
            <>
              <IconPlay className="h-4 w-4" />
              Download
            </>
          )}
        </button>
        {selected && (
          <span className="text-xs text-steam-muted">selected: {selected.fileName}</span>
        )}
      </div>

      {status === "queued" && (
        <p className="text-sm text-steam-green-light">
          Queued. Track progress on{" "}
          <Link href="/downloads" className="font-medium underline">
            Downloads
          </Link>
          .
        </p>
      )}
      {status === "error" && <p className="text-sm text-red-400">{message}</p>}
    </div>
  );
}
