"use client";

import { type KeyboardEvent, type MouseEvent, useState } from "react";

interface Platform {
  name: string;
  slug?: string;
}

const BADGE = "bg-black/40 px-1.5 py-0.5 text-[10px] uppercase leading-none";

/**
 * Compact platform badges for a catalog card. Shows the first three platforms;
 * a "+N" toggle reveals the rest inline (the card itself is a Link, so the
 * toggle stops the click from navigating). Renders nothing when empty.
 */
export function PlatformBadges({ platforms }: { platforms: Platform[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!platforms || platforms.length === 0) return null;

  const label = (p: Platform) => (p.slug ? p.slug.toUpperCase() : p.name);
  const shown = expanded ? platforms : platforms.slice(0, 3);
  const extra = platforms.length - 3;

  const toggle = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
      {shown.map((p) => (
        <span key={p.slug ?? p.name} title={p.name} className={`${BADGE} text-steam-blue-light`}>
          {label(p)}
        </span>
      ))}
      {extra > 0 && (
        <span
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toggle(e);
          }}
          className={`${BADGE} cursor-pointer text-steam-muted hover:text-steam-text`}
        >
          {expanded ? "−" : `+${extra}`}
        </span>
      )}
    </div>
  );
}
