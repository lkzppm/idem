"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

/**
 * A row of tabs over panels that the server already drew: choosing one swaps which panel shows.
 * One tab stop for the row; arrow keys, Home and End move and select (the automatic activation of
 * the ARIA tabs pattern, right here because switching is instant and costs nothing).
 */
export function ChartTabs({
  label,
  panels,
}: {
  label: string;
  panels: { id: string; label: string; node: ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const i = (to + panels.length) % panels.length;
    setActive(i);
    refs.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") move(active + 1);
    else if (e.key === "ArrowLeft") move(active - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(panels.length - 1);
    else return;
    e.preventDefault();
  };
  const current = panels[active] ?? panels[0];
  return (
    <div className="r-tabs">
      <div className="r-tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {panels.map((p, i) => (
          <button
            key={p.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-t-${p.id}`}
            aria-selected={i === active}
            aria-controls={`${base}-p`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-p`} aria-labelledby={current ? `${base}-t-${current.id}` : undefined}>
        {current?.node}
      </div>
    </div>
  );
}
