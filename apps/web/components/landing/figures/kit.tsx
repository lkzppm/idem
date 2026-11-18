import type { CSSProperties, ReactNode } from "react";

/**
 * Drawing kit for the landing's figures. Everything is SVG in the theme's tokens (globals.css,
 * `.fig`), so a figure follows light and dark and scales without blurring. Motion is CSS only:
 * `.hop` runs one short dash along a path drawn with `pathLength={100}` during the first quarter
 * of a cycle of `T` seconds, after `d` seconds; `.blink` shows something during its phase.
 * Reduced motion freezes packets mid-way and shows every highlight.
 */

export function Fig({
  title,
  w,
  h,
  className = "",
  children,
}: {
  title: string;
  w: number;
  h: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title} className={`fig ${className}`}>
      <title>{title}</title>
      {children}
    </svg>
  );
}

/** Timing for `.hop` / `.blink`: cycle `T`, delay `d` (seconds). */
export const at = (d: number, T = 4.8): CSSProperties =>
  ({ "--d": `${d}s`, "--T": `${T}s` }) as CSSProperties;

/** A node: a rounded box with a title and up to two lines under it. */
export function Node({
  x,
  y,
  w,
  h,
  title,
  lines = [],
  tone,
  dashed = false,
  faint = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines?: string[];
  tone?: "i" | "d";
  dashed?: boolean;
  faint?: boolean;
}) {
  const stroke = tone === "i" ? "s s-i" : tone === "d" ? "s s-d" : "s";
  return (
    <g opacity={faint ? 0.55 : 1}>
      <rect x={x} y={y} width={w} height={h} rx={7} className={`f-bg ${stroke} ${dashed ? "dash" : ""}`} />
      <text x={x + 12} y={y + 21} className={tone === "i" ? "f-i" : tone === "d" ? "f-d" : "f-fg"}>
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l} x={x + 12} y={y + 38 + i * 15} className="f-faint" style={{ fontSize: 10 }}>
          {l}
        </text>
      ))}
    </g>
  );
}

/** A connector, and optionally a packet running along it. */
export function Wire({
  d,
  packet,
  delay = 0,
  T = 4.8,
  dashed = false,
}: {
  d: string;
  packet?: "i" | "d";
  delay?: number;
  T?: number;
  dashed?: boolean;
}) {
  return (
    <g>
      <path d={d} className={`s ${dashed ? "dash" : ""}`} />
      {packet && (
        <path
          d={d}
          pathLength={100}
          className={`hop ${packet === "i" ? "s-i" : "s-d"}`}
          style={at(delay, T)}
        />
      )}
    </g>
  );
}

/** A small arrowhead at (x, y) pointing in `dir`. */
export function Head({ x, y, dir }: { x: number; y: number; dir: "r" | "l" | "d" | "u" }) {
  const p =
    dir === "r"
      ? `M${x - 5} ${y - 4}L${x} ${y}L${x - 5} ${y + 4}`
      : dir === "l"
        ? `M${x + 5} ${y - 4}L${x} ${y}L${x + 5} ${y + 4}`
        : dir === "d"
          ? `M${x - 4} ${y - 5}L${x} ${y}L${x + 4} ${y - 5}`
          : `M${x - 4} ${y + 5}L${x} ${y}L${x + 4} ${y + 5}`;
  return <path d={p} className="s s-fg" />;
}

/** A check mark, drawn. */
export function Tick({ x, y, tone = "d" }: { x: number; y: number; tone?: "i" | "d" }) {
  return (
    <path
      d={`M${x - 5} ${y}l3.5 3.5L${x + 6} ${y - 5}`}
      className={`s ${tone === "i" ? "s-i" : "s-d"}`}
      strokeWidth={1.6}
    />
  );
}
