"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/icons";

const TABS = [
  { href: "/", label: "Library" },
  { href: "/downloads", label: "Downloads" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// RomM has no separate display name, so the initial comes from the username.
function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Square avatar (real RomM image, or the user's initial) with a blue border. */
function Avatar({ username, hasAvatar }: { username: string; hasAvatar: boolean }) {
  const [imgError, setImgError] = useState(false);
  const showImage = hasAvatar && !imgError;
  return (
    <span
      className="flex h-8 w-8 items-center justify-center overflow-hidden border border-steam-blue bg-steam-panel-2 text-sm font-bold text-steam-text"
      title={username}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/api/me/avatar"
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        initial(username)
      )}
    </span>
  );
}

/** Avatar · username (· admin star) · log out icon. */
function UserNav({
  username,
  role,
  hasAvatar,
}: {
  username: string;
  role?: string;
  hasAvatar: boolean;
}) {
  const router = useRouter();
  const isAdmin = role?.toLowerCase() === "admin";

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2.5">
      <Avatar username={username} hasAvatar={hasAvatar} />
      <span className="flex items-center gap-1.5 text-[15px] font-semibold capitalize text-steam-text">
        {username}
        {isAdmin && (
          <span title="Administrator" className="inline-flex text-yellow-400" aria-label="Administrator">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M10 1.5l2.47 5.01 5.53.8-4 3.9.94 5.49L10 14.98l-4.95 2.6.94-5.48-4-3.9 5.53-.8L10 1.5z" />
            </svg>
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={logout}
        title="Log out"
        aria-label="Log out"
        className="ml-0.5 flex cursor-pointer items-center text-white transition hover:text-red-500"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M3 4.25A2.25 2.25 0 0 1 5.25 2h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h4.5a.75.75 0 0 1 0 1.5h-4.5A2.25 2.25 0 0 1 3 15.75V4.25Zm10.72 2.47a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H8.75a.75.75 0 0 1 0-1.5h6.69l-1.72-1.72a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname() ?? "/";
  const [user, setUser] = useState<{
    username: string;
    role?: string;
    hasAvatar: boolean;
  } | null>(null);

  useEffect(() => {
    // No chrome (and no session) on the login screen — skip the probe there.
    if (pathname === "/login") return;
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        setUser(
          d?.username
            ? { username: d.username, role: d.role, hasAvatar: Boolean(d.avatarPath) }
            : null,
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pathname]);

  // No chrome on the login screen.
  if (pathname === "/login") return null;

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-white/5 bg-steam-navy/85 backdrop-blur-xl">
      <nav className="grid h-full grid-cols-[1fr_auto_1fr] items-center px-8">
        <Link href="/" className="flex items-center gap-2.5 justify-self-start">
          <Logo className="h-6 w-6 text-steam-bright" />
          <span className="text-[15px] font-bold tracking-tight text-steam-bright">
            RomM <span className="text-steam-blue-light">Downloader</span>
          </span>
        </Link>

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

        <div className="flex items-center justify-self-end">
          {user && (
            <UserNav username={user.username} role={user.role} hasAvatar={user.hasAvatar} />
          )}
        </div>
      </nav>
    </header>
  );
}
