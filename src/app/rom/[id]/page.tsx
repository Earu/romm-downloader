import Link from "next/link";
import { notFound } from "next/navigation";
import { IconCheck, IconServer } from "@/components/icons";
import { UninstallButton } from "@/components/UninstallButton";
import { getRommClient } from "@/lib/clients";
import { getConfig } from "@/lib/config";
import { type InstalledRom, toInstalledRom } from "@/lib/romm/installed";

export const dynamic = "force-dynamic";

function fmtSize(b?: number): string {
  if (!b) return "—";
  const gb = b / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(b / 1024 ** 2).toFixed(0)} MB`;
}

export default async function RomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let rom: InstalledRom;
  try {
    const client = await getRommClient();
    rom = toInstalledRom(await client.getRom(Number(id)));
  } catch {
    notFound();
  }
  const { rommUrl: rommBase } = await getConfig();
  const rommRomUrl = `${rommBase.replace(/\/+$/, "")}/rom/${rom.id}`;

  return (
    <div className="grid gap-7 px-8 py-7 md:grid-cols-[230px_1fr]">
      <div className="self-start overflow-hidden bg-black/40 shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
        {rom.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={rom.coverUrl} alt={rom.name} className="w-full" />
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
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-steam-bright">{rom.name}</h1>
            <span className="inline-flex items-center gap-1.5 bg-steam-green/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-steam-green-light">
              <IconCheck className="h-3.5 w-3.5" strokeWidth={2.6} />
              Installed
            </span>
          </div>
        </div>

        {rom.summary && (
          <p className="max-w-2xl text-sm leading-relaxed text-steam-muted">{rom.summary}</p>
        )}

        <dl className="grid max-w-xl grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-steam-muted">Platform</dt>
          <dd className="text-steam-text">{rom.platformSlug || "—"}</dd>
          <dt className="text-steam-muted">File</dt>
          <dd className="truncate text-steam-text" title={rom.fileName}>
            {rom.fileName || "—"}
          </dd>
          <dt className="text-steam-muted">Size</dt>
          <dd className="text-steam-text">{fmtSize(rom.sizeBytes)}</dd>
        </dl>

        <div className="flex flex-wrap items-center gap-3 border-t border-steam-line pt-5">
          <a
            href={rommRomUrl}
            target="_blank"
            rel="noreferrer"
            className="steam-btn-green inline-flex items-center gap-2 px-4 py-2"
          >
            <IconServer className="h-4 w-4" /> View in RomM
          </a>
          <UninstallButton romId={rom.id} name={rom.name} />
        </div>
      </div>
    </div>
  );
}
