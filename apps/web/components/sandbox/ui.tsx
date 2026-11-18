"use client";

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronIcon } from "./icons";

/** Gap between the info button and its bubble, and the bubble's minimum margin to the viewport. */
const TIP_GAP = 8;
const TIP_MARGIN = 12;

/**
 * An "i" button with a bubble of help. It opens on hover (a fine pointer), on keyboard focus and on
 * a tap or click (which pins it until a click elsewhere or Escape). The bubble is portalled to the
 * body with fixed positioning, so no scrolling sidebar or window clips it: it sits to the right of
 * the button where there is room (the sidebar is on the left), otherwise below it.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; side: "right" | "below" } | null>(null);
  const closeTimer = useRef(0);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    if (pinned) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const hide = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(false);
    setPinned(false);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Place the bubble once it is in the DOM (its size is known then), and again on scroll/resize.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const b = btn.current?.getBoundingClientRect();
      const t = tip.current;
      if (!b || !t) return;
      const w = t.offsetWidth;
      const h = t.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const clampY = (y: number) => Math.max(TIP_MARGIN, Math.min(vh - TIP_MARGIN - h, y));
      if (b.right + TIP_GAP + w + TIP_MARGIN <= vw) {
        setPos({ x: b.right + TIP_GAP, y: clampY(b.top + b.height / 2 - 18), side: "right" });
      } else {
        const x = Math.max(TIP_MARGIN, Math.min(vw - TIP_MARGIN - w, b.left + b.width / 2 - w / 2));
        setPos({ x, y: b.bottom + TIP_GAP, side: "below" });
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // A pinned bubble closes on a press elsewhere; any open one on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!btn.current?.contains(n) && !tip.current?.contains(n)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      hide();
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  });

  const hover = (e: { pointerType: string }) => e.pointerType === "mouse";

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="obs-info"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        data-on={open || undefined}
        onPointerEnter={(e) => hover(e) && show()}
        onPointerLeave={(e) => hover(e) && hideSoon()}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && show()}
        onBlur={() => !pinned && hide()}
        onClick={(e) => {
          // Inside a <label>, a click would also toggle or focus the control.
          e.preventDefault();
          e.stopPropagation();
          if (pinned) hide();
          else {
            setPinned(true);
            show();
          }
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="obs-tip"
            data-side={pos?.side}
            style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? undefined : "hidden" }}
            onPointerEnter={(e) => hover(e) && show()}
            onPointerLeave={(e) => hover(e) && hideSoon()}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/** A control's label with an optional info button beside it. */
export function Label({
  htmlFor,
  tip,
  children,
}: {
  htmlFor?: string;
  tip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="obs-label-row">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="obs-label">
          {children}
        </label>
      ) : (
        <span className="obs-label">{children}</span>
      )}
      {tip && <InfoTip label={aboutLabel(children)}>{tip}</InfoTip>}
    </span>
  );
}

/**
 * The info button's accessible name, "About <label>", in the page language (read from `<html lang>`
 * like {@link fixed}: the sandbox's controls render only on the client, inside portals).
 */
export function aboutLabel(label: ReactNode): string {
  const pt = typeof document !== "undefined" && document.documentElement.lang.startsWith("pt");
  const text = typeof label === "string" ? label : "";
  if (!text) return pt ? "Sobre esta opção" : "About this setting";
  return pt ? `Sobre: ${text}` : `About ${text}`;
}

/** A labelled range input with its value in mono. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  tip,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  /** What the setting does, in an info bubble beside the label. */
  tip?: ReactNode;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="obs-field">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} tip={tip}>
          {label}
        </Label>
        <span className="t-mono text-[12px] text-fg tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Mutually exclusive options with an ink thumb that glides (and overshoots a little) to the choice. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "sm",
}: {
  label: string;
  value: T;
  /** `tip`: an info bubble beside the option's name (a sibling of its button, never inside it). */
  options: { value: T; label: ReactNode; title?: string; tip?: { label: string; body: ReactNode } }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <fieldset
      className="obs-seg"
      data-size={size}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <legend className="sr-only">{label}</legend>
      <span
        aria-hidden="true"
        className="obs-seg-thumb"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <span key={o.value} className="obs-seg-cell" data-tip={o.tip ? "" : undefined}>
          <button
            type="button"
            aria-pressed={o.value === value}
            title={o.title}
            onClick={() => onChange(o.value)}
            className="obs-seg-btn"
          >
            {o.label}
          </button>
          {o.tip && (
            <span className="obs-seg-tip">
              <InfoTip label={o.tip.label}>{o.tip.body}</InfoTip>
            </span>
          )}
        </span>
      ))}
    </fieldset>
  );
}

/** A compact button: `primary` is the Interest blue, `data` the answer yellow. */
export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  title,
  className = "",
  wide,
  kbd,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "data" | "secondary" | "ghost";
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Full width, left aligned. */
  wide?: boolean;
  /** A key that does the same thing. */
  kbd?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-wide={wide || undefined}
      className={`obs-btn ${className}`}
    >
      {children}
      {kbd && <kbd className="obs-kbd">{kbd}</kbd>}
    </button>
  );
}

/** A number with its label; `tone` colors the value with an accent. */
export function Stat({
  label,
  value,
  hint,
  tone,
  bar,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "interest" | "data";
  /** 0..1: a flat bar under the value. */
  bar?: number;
}) {
  return (
    <div className="obs-stat" data-tone={tone}>
      <span className="obs-stat-label">{label}</span>
      <span className="obs-stat-value">{value}</span>
      {bar !== undefined && (
        <span className="obs-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, bar))})` }} />
        </span>
      )}
      {hint && <span className="obs-stat-hint">{hint}</span>}
    </div>
  );
}

/** A sidebar section: a title row that folds the body away. */
export function Section({
  title,
  aside,
  children,
  defaultOpen = true,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="obs-section" data-open={open || undefined}>
      <div className="obs-section-head">
        <button
          type="button"
          className="obs-section-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="obs-section-title">{title}</span>
          <span className="obs-chevron">
            <ChevronIcon />
          </span>
        </button>
        {aside && <div className="ml-auto flex items-center gap-1.5">{aside}</div>}
      </div>
      <div className="obs-collapse" id={id} inert={!open ? true : undefined}>
        <div className="obs-collapse-inner">
          <div className="obs-section-body">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** A checkbox with its label. */
export function Check({
  label,
  checked,
  tip,
  tipLabel,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  tip?: ReactNode;
  /** The info button's accessible name. */
  tipLabel?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="obs-check-row">
      <label className="obs-check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {tip && <InfoTip label={tipLabel ?? aboutLabel(label)}>{tip}</InfoTip>}
    </div>
  );
}

/** A verdict: a small solid square and a word (never a pill). */
export function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className="obs-verdict" data-ok={ok || undefined}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

/** A placeholder line for an empty window. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="obs-empty">{children}</p>;
}

/** A labelled block of mono facts inside a window. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="obs-kv">
      <span className="obs-kv-label">{label}</span>
      <div className="obs-kv-value">{children}</div>
    </div>
  );
}

/**
 * `n.toFixed(digits)` with the page language's decimal mark (a comma in Portuguese). Read from
 * `<html lang>`, which the language switch updates: the sandbox's numbers render only on the client
 * (inside portals), so this never diverges from the server render.
 */
export function fixed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return typeof document !== "undefined" && document.documentElement.lang.startsWith("pt")
    ? s.replace(".", ",")
    : s;
}

/** A byte count in B, KiB or MiB. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${fixed(n / 1024, 1)} KiB`;
  return `${fixed(n / 1024 / 1024, 2)} MiB`;
}

/** A duration in ms (s from 10 s up); "—" when there is no value. */
export function fmtMs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n < 10 ? `${fixed(n, 1)} ms` : n < 10_000 ? `${Math.round(n)} ms` : `${fixed(n / 1000, 1)} s`;
}

/** A 0..1 ratio as a percentage with one decimal. */
export function fmtPct(n: number): string {
  return `${fixed(n * 100, 1)}%`;
}

/** `/idem/v1/p/tool/schema/args` → `tool · args[0:8]…` for compact display. */
export function shortName(name: string | undefined): string {
  if (!name) return "—";
  const parts = name.split("/");
  const tool = parts[4] ?? "?";
  const args = parts[6] ?? "";
  return `${tool} · ${args.slice(0, 8)}…`;
}

/** Middle-elided string (for digests and signatures). */
export function elide(s: string, keep = 10): string {
  return s.length <= keep * 2 + 1 ? s : `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

/** Median and 95th percentile of a sample (nearest rank), or NaN when empty. */
export function quantiles(xs: number[]): { p50: number; p95: number } {
  if (xs.length === 0) return { p50: Number.NaN, p95: Number.NaN };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] as number;
  return { p50: at(0.5), p95: at(0.95) };
}
