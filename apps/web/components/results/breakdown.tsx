"use client";

import { useState } from "react";
import type { Tone } from "./chart";

export interface BreakdownStep {
  key: string;
  tone: Tone;
  /** Who pays: already translated. */
  who: string;
  /** What they run (code). */
  what: string;
  /** Cost, formatted. */
  cost: string;
  /** Share of the whole miss cost, formatted. */
  share: string;
  value: number;
}

/**
 * The per-miss CPU cost as one bar and the list that names its parts. Hovering or focusing a part
 * (in the bar or in the list) lights it in both and fades the others; a line under the bar reads
 * it out. The figures are formatted on the server from the exported cost table.
 */
export function Breakdown({ steps, label, total }: { steps: BreakdownStep[]; label: string; total: string }) {
  const [on, setOn] = useState<string | null>(null);
  const sum = steps.reduce((s, p) => s + p.value, 0) || 1;
  let x = 0;
  const gap = 0.6;
  const at = steps.find((s) => s.key === on);
  return (
    <div className="r-breakdown">
      <svg className="r-split" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label={label}>
        <title>{label}</title>
        {steps.map((p) => {
          const w = (p.value / sum) * 100;
          const rect = (
            <rect
              key={p.key}
              className={`r-seg t-${p.tone}${on && on !== p.key ? " is-dim" : ""}`}
              x={Math.round(x * 100) / 100}
              y={0}
              width={Math.round(Math.max(0, w - gap) * 100) / 100}
              height={4}
              onPointerEnter={() => setOn(p.key)}
              onPointerLeave={() => setOn(null)}
            />
          );
          x += w;
          return rect;
        })}
      </svg>
      <p className="r-readline" aria-hidden="true">
        {at ? `${at.who} · ${at.what} · ${at.cost} · ${at.share}` : total}
      </p>
      <ol className="r-steps">
        {steps.map((p) => (
          <li
            key={p.key}
            tabIndex={0}
            className={on && on !== p.key ? "is-dim" : undefined}
            onPointerEnter={() => setOn(p.key)}
            onPointerLeave={() => setOn(null)}
            onFocus={() => setOn(p.key)}
            onBlur={() => setOn(null)}
          >
            <span className={`r-swatch t-${p.tone}`} aria-hidden="true" />
            <span className="r-step-who">{p.who}</span>
            <code>{p.what}</code>
            <span className="r-step-us">
              {p.cost}
              <span className="r-step-share"> · {p.share}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
