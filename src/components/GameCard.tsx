import Link from "next/link";
import { IconCheck } from "@/components/icons";

interface GameCardProps {
  href: string;
  name: string;
  coverUrl?: string;
  subtitle?: string;
  /** Show a checkmark badge — the game is installed in RomM. */
  installed?: boolean;
}

export function GameCard({ href, name, coverUrl, subtitle, installed }: GameCardProps) {
  return (
    <Link
      href={href}
      className="group block overflow-hidden bg-steam-deep shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-2 ring-transparent transition duration-150 hover:z-10 hover:scale-[1.04] hover:ring-white hover:shadow-[0_8px_24px_rgba(0,0,0,0.65)]"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-black/50">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt={name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-steam-muted">
            no cover
          </div>
        )}
        {installed && (
          <span
            title="Installed in RomM"
            className="absolute bottom-1.5 right-1.5 grid h-6 w-6 place-items-center bg-steam-green-light text-steam-deep shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
          >
            <IconCheck className="h-4 w-4" strokeWidth={2.6} />
          </span>
        )}
      </div>

      <div className="bg-steam-row px-2.5 py-2 text-center">
        <p className="truncate text-sm font-bold text-steam-bright" title={name}>
          {name}
        </p>
        <p className="text-xs font-medium text-steam-muted">{subtitle ?? "—"}</p>
      </div>
    </Link>
  );
}
