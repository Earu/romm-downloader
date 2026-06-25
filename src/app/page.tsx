"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameCard } from "@/components/GameCard";
import { IconSearch, Spinner } from "@/components/icons";
import type { CatalogGame } from "@/lib/catalog/types";
import { normalizeTitle, type InstalledRom } from "@/lib/romm/installed";

/** Placeholder capsule shown while content loads. */
function SkeletonCard() {
  return (
    <div className="overflow-hidden bg-steam-deep">
      <div className="aspect-[3/4] w-full animate-pulse bg-steam-row" />
      <div className="bg-steam-row px-2.5 py-2">
        <div className="mx-auto h-3.5 w-4/5 animate-pulse bg-white/10" />
        <div className="mx-auto mt-1.5 h-2.5 w-8 animate-pulse bg-white/10" />
      </div>
    </div>
  );
}

interface CatalogResponse {
  enabled: boolean;
  games: CatalogGame[];
  error?: string;
}

type Tab = "all" | "installed";

const GRID = "grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [term, setTerm] = useState("");
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [installed, setInstalled] = useState<InstalledRom[] | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCatalog = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      setData(await res.json());
    } catch (e) {
      setData({ enabled: true, games: [], error: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  // Installed ROMs power both the "Installed" tab and the badges on "Global".
  const loadInstalled = useCallback(async () => {
    try {
      const res = await fetch("/api/roms", { cache: "no-store" });
      const json = await res.json();
      setInstalled(json.roms ?? []);
    } catch {
      setInstalled([]);
    }
  }, []);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  // Catalog: initial popular load + debounced search (Global tab only).
  useEffect(() => {
    if (tab !== "all") return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void loadCatalog(term), term ? 350 : 0);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [term, tab, loadCatalog]);

  // Map of normalised title -> installed ROM, for badges/links on Global.
  const installedByKey = useMemo(() => {
    const m = new Map<string, InstalledRom>();
    for (const r of installed ?? []) if (r.matchKey) m.set(r.matchKey, r);
    return m;
  }, [installed]);

  const filteredInstalled = useMemo(() => {
    const list = installed ?? [];
    const q = normalizeTitle(term);
    return q ? list.filter((r) => r.matchKey.includes(q)) : list;
  }, [installed, term]);

  return (
    <div className="space-y-6 px-8 py-7">
      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          {(["all", "installed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-5 py-2 text-sm font-semibold uppercase tracking-wide transition " +
                (tab === t
                  ? "bg-white/10 text-steam-bright"
                  : "text-steam-muted hover:text-steam-text")
              }
            >
              {t}
              {t === "installed" && installed && (
                <span className="ml-1.5 text-steam-muted">({installed.length})</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steam-muted" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={tab === "all" ? "Search games…" : "Filter installed…"}
            className="steam-input w-96 pl-9"
          />
        </div>
      </div>

      {tab === "all" ? (
        <>
          {data && !data.enabled && (
            <div className="border-l-2 border-amber-500 bg-amber-500/10 p-4 text-sm text-amber-200">
              The game catalog needs IGDB credentials. Add <code>IGDB_CLIENT_ID</code> and{" "}
              <code>IGDB_CLIENT_SECRET</code> under{" "}
              <a className="font-medium underline" href="/settings">
                Settings
              </a>
              .
            </div>
          )}
          {data?.error && data.enabled && (
            <div className="border-l-2 border-red-500 bg-red-500/10 p-4 text-sm text-red-200">
              {data.error}
            </div>
          )}
          {(data === null || data.enabled) && (
            <section className="space-y-4">
              <div className="flex items-center gap-4">
                <h2 className="steam-shelf-title">
                  {term.trim() ? `Results for “${term.trim()}”` : "Popular Games"}
                </h2>
                <div className="h-px flex-1 bg-steam-line" />
                {loading && <Spinner className="h-4 w-4 text-steam-blue-light" />}
              </div>
              <div className={GRID}>
                {data === null
                  ? Array.from({ length: 30 }).map((_, i) => <SkeletonCard key={i} />)
                  : data.games.map((g) => {
                      const rom = installedByKey.get(normalizeTitle(g.name));
                      return (
                        <GameCard
                          key={g.id}
                          href={rom ? `/rom/${rom.id}` : `/game/${g.id}`}
                          name={g.name}
                          coverUrl={g.coverUrl}
                          subtitle={g.releaseYear ? String(g.releaseYear) : undefined}
                          installed={!!rom}
                        />
                      );
                    })}
              </div>
              {data !== null && !loading && data.games.length === 0 && (
                <p className="text-sm text-steam-muted">No results.</p>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="space-y-4">
          <div className="flex items-center gap-4">
            <h2 className="steam-shelf-title">Installed Games</h2>
            <div className="h-px flex-1 bg-steam-line" />
            {installed === null && <Spinner className="h-4 w-4 text-steam-blue-light" />}
          </div>
          <div className={GRID}>
            {installed === null
              ? Array.from({ length: 14 }).map((_, i) => <SkeletonCard key={i} />)
              : filteredInstalled.map((r) => (
                  <GameCard
                    key={r.id}
                    href={`/rom/${r.id}`}
                    name={r.name}
                    coverUrl={r.coverUrl}
                    subtitle={r.platformSlug || undefined}
                    installed
                  />
                ))}
          </div>
          {installed !== null && filteredInstalled.length === 0 && (
            <p className="text-sm text-steam-muted">
              {installed.length === 0
                ? "No games installed in RomM yet."
                : "No installed games match your filter."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
