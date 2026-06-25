/**
 * Monochrome line icons. All use `currentColor` and a transparent background,
 * so they inherit text color (white by default) — set size/color via className,
 * e.g. <IconSearch className="h-4 w-4 text-steam-muted" />.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Brand mark: a download arrow dropping into a cartridge/library tile. */
export function Logo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect
        x="2.75"
        y="2.75"
        width="18.5"
        height="18.5"
        rx="3.5"
        stroke="currentColor"
        strokeWidth={1.8}
      />
      <path
        d="M12 6.5v6.25M9.25 10.25 12 13l2.75-2.75"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 16.75h8"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  );
}

export function IconServer(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </Svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M11 6.5 12.2 5.3a4 4 0 0 1 5.7 5.7l-1.2 1.2" />
      <path d="M13 17.5 11.8 18.7a4 4 0 0 1-5.7-5.7l1.2-1.2" />
    </Svg>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </Svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h4l2.5-7 5 14 2.5-7H21" />
    </Svg>
  );
}

export function IconDrive(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 13 8 5h8l3 8" />
      <rect x="3" y="13" width="18" height="6" rx="1.5" />
      <path d="M7 16h.01" />
    </Svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6 18 18M18 6 6 18" />
    </Svg>
  );
}

/** Checkmark. */
export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </Svg>
  );
}

/** Trash can — uninstall/remove. */
export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </Svg>
  );
}

/** Circular arrow — retry. */
export function IconRetry(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 4v4.5h-4.5" />
    </Svg>
  );
}

/** Spinning loader arc. */
export function Spinner({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`animate-spin ${className ?? ""}`}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} opacity={0.2} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

/** Filled play triangle (for the acquire button). */
export function IconPlay(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  );
}
