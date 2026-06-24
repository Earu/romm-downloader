"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameCard } from "@/components/GameCard";
import { IconSearch, Spinner } from "@/components/icons";
import type { CatalogGame } from "@/lib/catalog/types";

/** Placeholder capsule shown while the catalog loads. */
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

export default function CatalogPage() {
  const [term, setTerm] = useState("");
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });
      setData(await res.json());
    } catch (e) {
      setData({ enabled: true, games: [], error: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load (popular) + debounced search on typing.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(term), term ? 350 : 0);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [term, load]);

  const heading = term.trim() ? `Results for “${term.trim()}”` : "Popular Games";

  return (
    <div className="space-y-7 px-8 py-7">
      <div className="flex items-center justify-end">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steam-muted" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search games…"
            className="steam-input w-96 pl-9"
          />
        </div>
      </div>

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
            <h2 className="steam-shelf-title">{heading}</h2>
            <div className="h-px flex-1 bg-steam-line" />
            {loading && <Spinner className="h-4 w-4 text-steam-blue-light" />}
          </div>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
            {data === null
              ? Array.from({ length: 30 }).map((_, i) => <SkeletonCard key={i} />)
              : data.games.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
          {data !== null && !loading && data.games.length === 0 && (
            <p className="text-sm text-steam-muted">No results.</p>
          )}
        </section>
      )}
    </div>
  );
}
