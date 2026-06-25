"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconPlay, Spinner } from "@/components/icons";
import { KNOWN_PLATFORMS, type KnownPlatform } from "@/lib/platforms";

export interface RommPlatformOption {
  id: number;
  name: string;
  slug: string;
  fsSlug: string;
}

interface MinervaResult {
  fullPath: string;
  fileName: string;
  platformSlug?: string;
  platformName?: string;
}

interface Props {
  game: { id: string; name: string; coverUrl?: string };
  /** Platforms that already exist in RomM — used for ID lookup and presence indicator. */
  rommPlatforms: RommPlatformOption[];
  /** Suggested fs_slug based on the game's IGDB platform data. */
  suggestedSlug?: string;
}

function filterPlatforms(query: string): KnownPlatform[] {
  const q = query.toLowerCase().trim();
  if (!q) return KNOWN_PLATFORMS;
  return KNOWN_PLATFORMS.filter(
    (p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
  );
}

export function DownloadPanel({ game, rommPlatforms, suggestedSlug }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(game.name);
  const [results, setResults] = useState<MinervaResult[]>([]);
  const [selected, setSelected] = useState<MinervaResult | null>(null);
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
  const [status, setStatus] = useState<"idle" | "submitting" | "queued" | "error">("idle");
  const [message, setMessage] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const runSearch = useCallback(async (q: string, all: boolean) => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch(
        `/api/minerva/search?q=${encodeURIComponent(q)}${all ? "&all=1" : ""}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      setNotSynced(Boolean(data.notSynced));
      setResults(data.results ?? []);
      if (data.error && !data.notSynced) setSearchError(data.error);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSearch(query, includeAll), 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, includeAll, runSearch]);

  const selectPlatform = (p: KnownPlatform) => {
    setSelectedPlatform(p);
    setPlatformQuery(p.name);
    setComboOpen(false);
  };

  // Picking a ROM result auto-selects its inferred platform in the combobox.
  const selectResult = (r: MinervaResult) => {
    setSelected(r);
    if (r.platformSlug) {
      const p = KNOWN_PLATFORMS.find((kp) => kp.slug === r.platformSlug);
      if (p) {
        setSelectedPlatform(p);
        setPlatformQuery(p.name);
      }
    }
  };

  const submit = async () => {
    if (!selected || !selectedPlatform) return;

    const existing = rommBySlug.get(selectedPlatform.slug);
    const platformSlug = selectedPlatform.slug;
    const platformId = existing?.id; // undefined → API will create it

    setStatus("submitting");
    setMessage("");
    try {
      const body: Record<string, unknown> = {
        minervaPath: selected.fullPath,
        title: selected.fileName,
        catalogGameId: game.id,
        coverUrl: game.coverUrl,
        platformSlug,
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
    !!selected && !!selectedPlatform && status !== "submitting" && status !== "queued";

  return (
    <div className="steam-panel space-y-3.5 p-5">
      <div>
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium uppercase tracking-wide text-steam-muted">
            Find the ROM on Minerva
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
          {results.map((r) => (
            <button
              key={r.fullPath}
              onClick={() => selectResult(r)}
              className={`flex w-full items-center gap-2 border-b border-steam-line px-3 py-2 text-left text-xs transition last:border-b-0 ${
                selected?.fullPath === r.fullPath
                  ? "bg-steam-blue/25 text-steam-bright"
                  : "text-steam-muted hover:bg-white/[0.04] hover:text-steam-text"
              }`}
              title={r.fullPath}
            >
              <span className="truncate">{r.fileName}</span>
              {r.platformName && (
                <span className="ml-auto shrink-0 bg-black/40 px-2 py-0.5 text-[10px] text-steam-blue-light">
                  {r.platformName}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

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
            {selectedPlatform && rommBySlug.has(selectedPlatform.slug) && (
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
                    const inRomm = rommBySlug.has(p.slug);
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
          {selectedPlatform && !rommBySlug.has(selectedPlatform.slug) && (
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
