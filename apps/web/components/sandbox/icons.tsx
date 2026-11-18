import type { ReactNode } from "react";
import type { WindowId } from "@/lib/sandbox/layout";

/** A 16 px stroke glyph in the current text color. */
function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Close (×). */
export function CloseIcon() {
  return (
    <Glyph>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </Glyph>
  );
}

/** Collapse / expand chevron; the CSS turns it. */
export function ChevronIcon() {
  return (
    <Glyph>
      <path d="M4.5 6.5L8 10l3.5-3.5" />
    </Glyph>
  );
}

export function PlayIcon() {
  return (
    <Glyph>
      <path d="M5.5 3.8v8.4L12 8z" fill="currentColor" />
    </Glyph>
  );
}

export function PauseIcon() {
  return (
    <Glyph>
      <path d="M5.5 4v8M10.5 4v8" strokeWidth="2.2" />
    </Glyph>
  );
}

export function RestartIcon() {
  return (
    <Glyph>
      <path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3" />
      <path d="M3.5 3v2.6h2.6" />
    </Glyph>
  );
}

/** Back (an arrow pointing left). */
export function BackIcon() {
  return (
    <Glyph>
      <path d="M12.5 8h-9M7.5 4l-4 4 4 4" />
    </Glyph>
  );
}

/** Plus, drawn large on the start screen's blank canvas tile. */
export function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Glyph>
  );
}

/** A small arrow pointing right (a row that opens something). */
export function ArrowIcon() {
  return (
    <Glyph>
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </Glyph>
  );
}

/** A warning triangle. */
export function WarnIcon() {
  return (
    <Glyph>
      <path d="M8 2.8l5.6 9.8H2.4z" />
      <path d="M8 6.6v2.6" />
      <circle cx="8" cy="11" r="0.7" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function HelpIcon() {
  return (
    <Glyph>
      <path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.5" />
      <circle cx="8" cy="11.8" r="0.8" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function LayoutIcon() {
  return (
    <Glyph>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="M9.5 3v10M9.5 8h4" />
    </Glyph>
  );
}

/** A glyph per window, used in the sidebar list and the phone tabs. */
export function WindowIcon({ id }: { id: WindowId }) {
  switch (id) {
    case "log":
      return (
        <Glyph>
          <path d="M3 4.5h10M3 8h7M3 11.5h8.5" />
        </Glyph>
      );
    case "tables":
      return (
        <Glyph>
          <rect x="2.5" y="3" width="11" height="10" rx="2" />
          <path d="M2.5 6.5h11M7 6.5V13" />
        </Glyph>
      );
    case "inspector":
      return (
        <Glyph>
          <circle cx="7" cy="7" r="3.8" />
          <path d="M10 10l3 3" />
        </Glyph>
      );
    case "metrics":
      return (
        <Glyph>
          <path d="M3.5 12.5V8.5M8 12.5V3.5M12.5 12.5V6.5" strokeWidth="2" />
        </Glyph>
      );
    case "compare":
      return (
        <Glyph>
          <path d="M5 12.5V5M11 12.5V9" strokeWidth="2.4" />
          <path d="M2.5 13h11" />
        </Glyph>
      );
    case "safety":
      return (
        <Glyph>
          <path d="M8 2.5l4.5 1.8v3.4c0 2.9-2 4.9-4.5 5.8-2.5-.9-4.5-2.9-4.5-5.8V4.3z" />
          <path d="M6 8l1.5 1.5L10.3 6.7" />
        </Glyph>
      );
  }
}
