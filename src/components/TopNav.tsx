"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/icons";

const TABS = [
  { href: "/", label: "Library" },
  { href: "/downloads", label: "Downloads" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function TopNav() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-white/5 bg-steam-navy/85 backdrop-blur-xl">
      <nav className="grid h-full grid-cols-[1fr_auto_1fr] items-center px-8">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 justify-self-start">
          <Logo className="h-6 w-6 text-steam-bright" />
          <span className="text-[15px] font-bold tracking-tight text-steam-bright">
            RomM <span className="text-steam-blue-light">Downloader</span>
          </span>
        </Link>

        {/* Centered pill tabs */}
        <div className="flex items-center gap-1 justify-self-center">
          {TABS.map((t) => {
            const active = isActive(pathname, t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={
                  "px-6 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] transition " +
                  (active
                    ? "bg-white/10 text-steam-bright"
                    : "text-steam-muted hover:text-steam-text")
                }
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {/* Right status spacer (keeps tabs optically centred) */}
        <div className="justify-self-end" />
      </nav>
    </header>
  );
}
