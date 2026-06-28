import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadPanel, type RommPlatformOption } from "@/components/DownloadPanel";
import { InstallTracker } from "@/components/InstallTracker";
import { getCatalogProvider } from "@/lib/catalog";
import { getRommClient } from "@/lib/clients";
import { PLATFORM_BY_SLUG, toRommFsSlug } from "@/lib/platforms";

export const dynamic = "force-dynamic";

async function loadRommPlatforms(): Promise<RommPlatformOption[]> {
  try {
    const client = await getRommClient();
    const platforms = await client.listPlatforms();
    return platforms.map((p) => ({
      id: p.id,
      name: p.custom_name || p.name,
      slug: p.slug,
      fsSlug: p.fs_slug,
    }));
  } catch {
    return [];
  }
}

export default async function GameDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ info?: string; job?: string }>;
}) {
  const { id } = await params;
  // `?info=1` (e.g. opened from a download's cover) makes this a read-only info
  // page — no source search, no download controls. A `job` id, when present,
  // tracks that download and links to the installed game on RomM once it's done.
  const { info, job: jobId } = await searchParams;
  const infoOnly = info === "1";
  const provider = await getCatalogProvider();
  if (!provider.isEnabled()) {
    return (
      <p className="text-sm text-white/60">
        Catalog not configured. See{" "}
        <Link className="underline" href="/settings">
          Settings
        </Link>
        .
      </p>
    );
  }

  const [game, rommPlatforms] = await Promise.all([
    provider.getById(id),
    infoOnly ? Promise.resolve<RommPlatformOption[]>([]) : loadRommPlatforms(),
  ]);
  if (!game) notFound();

  // Suggest a platform by matching the game's IGDB platform slugs against our
  // known platform list, preferring ones that already exist in RomM.
  const igdbSlugs = game.platforms.map((p) => p.slug).filter((s): s is string => !!s);
  const rommFsSlugs = new Set(rommPlatforms.map((p) => p.fsSlug));
  const suggestedSlug =
    igdbSlugs.find((s) => rommFsSlugs.has(toRommFsSlug(s)) && PLATFORM_BY_SLUG.has(s)) ??
    igdbSlugs.find((s) => PLATFORM_BY_SLUG.has(s));

  return (
    <div className="grid gap-7 px-8 py-7 md:grid-cols-[230px_1fr]">
      <div className="self-start overflow-hidden bg-black/40 shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
        {game.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={game.coverUrl} alt={game.name} className="w-full" />
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center text-steam-muted">
            no cover
          </div>
        )}
      </div>

      <div className="space-y-5">
        <div>
          <Link
            href="/"
            className="text-xs font-medium text-steam-muted transition hover:text-steam-blue-light"
          >
            ← Library
          </Link>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-steam-bright">
            {game.name}{" "}
            <span className="font-normal text-steam-muted">{game.releaseYear ?? ""}</span>
          </h1>
        </div>

        {game.summary && (
          <p className="max-w-2xl text-sm leading-relaxed text-steam-muted">
            {game.summary}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {game.platforms.map((p) => (
            <span
              key={p.id}
              className="bg-steam-row px-2.5 py-1 text-xs text-steam-text"
            >
              {p.name}
            </span>
          ))}
        </div>

        {infoOnly
          ? jobId && <InstallTracker jobId={jobId} />
          : (
            <DownloadPanel
              game={{ id: game.id, name: game.name, coverUrl: game.coverUrl }}
              rommPlatforms={rommPlatforms}
              suggestedSlug={suggestedSlug}
              platformSlugs={igdbSlugs}
            />
          )}
      </div>
    </div>
  );
}
