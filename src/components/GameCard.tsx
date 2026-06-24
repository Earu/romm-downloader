import Link from "next/link";
import type { CatalogGame } from "@/lib/catalog/types";

export function GameCard({ game }: { game: CatalogGame }) {
  return (
    <Link
      href={`/game/${game.id}`}
      className="group block overflow-hidden bg-steam-deep shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-2 ring-transparent transition duration-150 hover:z-10 hover:scale-[1.04] hover:ring-white hover:shadow-[0_8px_24px_rgba(0,0,0,0.65)]"
    >
      <div className="aspect-[3/4] w-full overflow-hidden bg-black/50">
        {game.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.coverUrl}
            alt={game.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-steam-muted">
            no cover
          </div>
        )}
      </div>

      {/* Footer label bar beneath the cover (SteamOS capsule style). */}
      <div className="bg-steam-row px-2.5 py-2 text-center">
        <p className="truncate text-sm font-bold text-steam-bright" title={game.name}>
          {game.name}
        </p>
        <p className="text-xs font-medium text-steam-muted">{game.releaseYear ?? "—"}</p>
      </div>
    </Link>
  );
}
