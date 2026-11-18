"use client";

import { type CSSProperties, type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useMessages } from "@/lib/i18n/client";
import { landing } from "@/lib/i18n/messages/landing";
import { CanonicalizeFigure, NameFigure, ServeFigure, SignFigure } from "./figures/steps";
import { Braces, Hash, Network, Nib } from "./icons";

const ICONS: ((p: { size?: number; className?: string }) => ReactNode)[] = [Braces, Hash, Nib, Network];
const FIGURES: (() => ReactNode)[] = [CanonicalizeFigure, NameFigure, SignFigure, ServeFigure];

/** Seconds a step stays before the next one comes in (its figure plays once, then holds). */
const STEP_SECONDS = 9;

/**
 * The four steps of an IDEM call, as tabs that turn on their own (a blue line fills under the
 * current one). Each step's figure plays once when it opens and holds its last frame; clicking the
 * open tab plays it again. The pointer over the card pauses the turning; reduced motion turns it off
 * and shows each figure's last frame.
 */
export function Steps() {
  const t = useMessages(landing).how;
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [hovered, setHovered] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const paused = hovered || reduced;
  const step = t.steps[index] ?? t.steps[0];
  const Figure = FIGURES[index] ?? CanonicalizeFigure;

  const go = (i: number, focus = false) => {
    const n = (i + t.steps.length) % t.steps.length;
    if (n === index) setRun((r) => r + 1);
    setIndex(n);
    if (focus) tabs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(index + 1, true);
    else if (e.key === "ArrowLeft") go(index - 1, true);
    else if (e.key === "Home") go(0, true);
    else if (e.key === "End") go(t.steps.length - 1, true);
    else return;
    e.preventDefault();
  };

  return (
    <figure
      className="fig-card overflow-hidden"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        role="tablist"
        aria-label={t.tabs}
        className="grid grid-cols-4 border-b border-line"
        onKeyDown={onKey}
      >
        {t.steps.map((s, i) => {
          const Icon = ICONS[i] ?? Braces;
          const on = i === index;
          return (
            <button
              key={s.label}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`step-tab-${i}`}
              aria-selected={on}
              aria-controls="step-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => go(i)}
              className="step-tab group"
            >
              <Icon size={16} className="step-icon hidden sm:block" />
              <span>{s.label}</span>
              {!on && <span aria-hidden="true" className="step-hover" />}
              {on && (
                <span
                  key={`${index}-${run}`}
                  aria-hidden="true"
                  className={`step-bar ${reduced ? "" : "animate-[grow_var(--step)_linear_both]"}`}
                  style={
                    {
                      "--step": `${STEP_SECONDS}s`,
                      animationPlayState: paused ? "paused" : "running",
                    } as CSSProperties
                  }
                  onAnimationEnd={() => go(index + 1)}
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        key={`${index}-${run}`}
        id="step-panel"
        role="tabpanel"
        aria-labelledby={`step-tab-${index}`}
        className="animate-[swap-in_0.4s_var(--ease)] p-5 sm:p-7"
      >
        <p className="flex items-baseline gap-3">
          <span className="step-num">{index + 1}</span>
          <span className="font-display text-lg font-semibold tracking-[-0.02em]">{step?.label}</span>
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-pretty text-muted sm:min-h-[4.9rem]">
          {step?.body}
        </p>
        <div className="mt-5">
          <Figure />
        </div>
      </div>
    </figure>
  );
}
