// Interface glyphs for the landing: 24-box, 1.5 stroke, current colour (lucide's register,
// drawn here so the site carries no icon dependency).
import type { ReactNode } from "react";

function Glyph({
  size = 16,
  className = "",
  children,
}: {
  size?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

type P = { size?: number; className?: string };

export const Arrow = (p: P) => (
  <Glyph {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Glyph>
);
export const ChevronDown = (p: P) => (
  <Glyph {...p}>
    <path d="m6 9 6 6 6-6" />
  </Glyph>
);
/** Canonicalize: braces. */
export const Braces = (p: P) => (
  <Glyph {...p}>
    <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
  </Glyph>
);
/** Name: a hash. */
export const Hash = (p: P) => (
  <Glyph {...p}>
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </Glyph>
);
/** Sign: a pen nib. */
export const Nib = (p: P) => (
  <Glyph {...p}>
    <path d="m12 19 7-7 3 3-7 7-3-3Z" />
    <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5Z" />
    <path d="m2 2 7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </Glyph>
);
/** Serve: a node tree. */
export const Network = (p: P) => (
  <Glyph {...p}>
    <rect x="16" y="16" width="6" height="6" />
    <rect x="2" y="16" width="6" height="6" />
    <rect x="9" y="2" width="6" height="6" />
    <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8" />
  </Glyph>
);
/** A signed document. */
export const FileSigned = (p: P) => (
  <Glyph {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6M8 13h4M8 17h2" />
    <circle cx="16" cy="16" r="2" />
  </Glyph>
);
export const Lock = (p: P) => (
  <Glyph {...p}>
    <rect x="3" y="11" width="18" height="11" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Glyph>
);
export const BadgeCheck = (p: P) => (
  <Glyph {...p}>
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5Z" />
    <path d="m9 12 2 2 4-4" />
  </Glyph>
);
export const Bypass = (p: P) => (
  <Glyph {...p}>
    <path d="M3 12h4l3-6h4M3 12h18M17 3l4 3-4 3M17 15l4 3-4 3" />
    <path d="M14 18h7" />
  </Glyph>
);
export const Copy = (p: P) => (
  <Glyph {...p}>
    <rect x="8" y="8" width="13" height="13" />
    <path d="M4 16V4h12" />
  </Glyph>
);
export const Check = (p: P) => (
  <Glyph {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Glyph>
);
export const Refresh = (p: P) => (
  <Glyph {...p}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
  </Glyph>
);
