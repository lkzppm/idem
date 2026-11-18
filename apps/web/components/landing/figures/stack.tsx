"use client";

import type { CSSProperties } from "react";
import { useMessages } from "@/lib/i18n/client";
import { landing } from "@/lib/i18n/messages/landing";

/**
 * Where IDEM sits: the stack, exploded, IP at the bottom and the application on top, with the IDEM
 * overlay between HTTP and the application. When it scrolls into view (inside a `Reveal`) the slabs
 * drop onto each other from the bottom up and land with a squash; the IDEM slab lands last and
 * carries a blue Interest and a yellow Data on its face. Hovering a slab lifts it. Reduced motion
 * shows the stack assembled.
 */
export function StackFigure() {
  const t = useMessages(landing).where;
  const a = 150;
  const b = 56;
  const th = 12;
  const cx = 175;
  return (
    <div className="fig-card stack px-4 py-6 sm:px-8 sm:py-8">
      <svg viewBox="0 0 560 400" role="img" aria-label={t.figTitle} className="fig mfig">
        <title>{t.figTitle}</title>
        {t.layers.map((l, i) => {
          const cy = 318 - i * 44;
          const idem = i === 4;
          const top = `M${cx - a} ${cy}L${cx} ${cy - b}L${cx + a} ${cy}L${cx} ${cy + b}Z`;
          const left = `M${cx - a} ${cy}L${cx} ${cy + b}L${cx} ${cy + b + th}L${cx - a} ${cy + th}Z`;
          const right = `M${cx} ${cy + b}L${cx + a} ${cy}L${cx + a} ${cy + th}L${cx} ${cy + b + th}Z`;
          return (
            <g
              key={l.name}
              className={`slab ${idem ? "slab-idem" : ""}`}
              style={{ "--i": i } as CSSProperties}
            >
              <g className="slab-body">
                <path d={left} className="slab-side" />
                <path d={right} className="slab-side" />
                <path d={top} className="slab-top" />
                {idem && (
                  <g>
                    <rect x={cx - 66} y={cy + 6} width={22} height={9} rx={4.5} className="f-db slab-pk" />
                    <rect x={cx + 40} y={cy + 10} width={22} height={9} rx={4.5} className="f-i slab-pk" />
                  </g>
                )}
              </g>
              <path d={`M${cx + a + 6} ${cy}H${cx + a + 26}`} className="ln" />
              <text x={cx + a + 34} y={cy - 1} className={`lbl lbl-strong ${idem ? "slab-name-i" : ""}`}>
                {l.name}
              </text>
              <text x={cx + a + 34} y={cy + 15} className="lbl">
                {l.what}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
