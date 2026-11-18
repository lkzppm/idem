"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { WarnIcon } from "./icons";

/**
 * The player bar over the canvas (ADR-029): the run's transport (play or pause, restart, speed), its
 * clock and progress, or what stops it from running. The shell gives it a slot at the top of the
 * stage; each mode fills it with these pieces.
 */

/** A transport button. The primary one (play or pause) is the larger, filled one. */
export function PlayerButton({
  label,
  kbd,
  primary,
  disabled,
  onClick,
  children,
}: {
  label: string;
  kbd?: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="obs-pbtn"
      data-primary={primary || undefined}
      aria-label={label}
      title={kbd ? `${label} (${kbd})` : label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A labelled action in the bar (Live's burst). */
export function PlayerAction({
  primary,
  disabled,
  kbd,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  kbd?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="obs-paction"
      data-primary={primary || undefined}
      disabled={disabled}
      title={kbd}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A thin dashed divider between groups. */
export function PlayerSep() {
  return <span className="obs-psep" aria-hidden="true" />;
}

/** How far the run is: a bar and its count. */
export function PlayerProgress({ value, label, title }: { value: number; label: string; title: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <span className="obs-pprog-wrap" title={title}>
      <span
        className="obs-pprog"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
      >
        <span className="obs-pprog-fill" style={{ transform: `scaleX(${v})` }} />
      </span>
      <span className="obs-pprog-label t-mono tabular-nums">{label}</span>
    </span>
  );
}

/** Close a popover on a press outside it or on Escape. */
function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLSpanElement>(null);
  const fn = useRef(close);
  fn.current = close;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) fn.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      fn.current();
    };
    document.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return box;
}

const fmtSpeed = (v: number) => `${Number(v.toPrecision(3))}×`;

/** The playback speed: a button showing it, and a menu of speeds. */
export function SpeedMenu({
  value,
  presets,
  label,
  onChange,
}: {
  value: number;
  presets: readonly number[];
  label: string;
  onChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, () => setOpen(false));
  const id = useId();
  const list = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b);
  return (
    <span ref={box} className="obs-pmenu-wrap">
      <button
        type="button"
        className="obs-pspeed t-mono tabular-nums"
        aria-label={`${label}: ${fmtSpeed(value)}`}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {fmtSpeed(value)}
      </button>
      {open && (
        <span id={id} className="obs-pmenu" role="group" aria-label={label}>
          <span className="obs-pmenu-title">{label}</span>
          {list.map((v) => (
            <button
              key={v}
              type="button"
              className="obs-pmenu-item t-mono tabular-nums"
              aria-pressed={v === value}
              onClick={() => {
                onChange(v);
                setOpen(false);
              }}
            >
              {fmtSpeed(v)}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** What stops the network from running: the first reason inline, all of them on a click. */
export function PlayerIssues({ title, items }: { title: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, () => setOpen(false));
  const id = useId();
  if (items.length === 0) return null;
  return (
    <span ref={box} className="obs-pmenu-wrap">
      <button
        type="button"
        className="obs-pissues"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <WarnIcon />
        <span className="obs-pissues-text">{items[0]}</span>
        {items.length > 1 && <span className="obs-pissues-more">+{items.length - 1}</span>}
      </button>
      {open && (
        <span id={id} className="obs-pmenu obs-pmenu-wide" role="group" aria-label={title}>
          <span className="obs-pmenu-title">{title}</span>
          <ul className="obs-issues">
            {items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}
