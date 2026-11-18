"use client";

import { type ReactNode, useEffect, useState } from "react";
import { CloseIcon } from "./icons";

/** How long a card takes to leave (ms). */
const LEAVE_MS = 170;

/** What a card shows for an item: its glyph, title, kind and body. */
export interface CardFace {
  glyph: ReactNode;
  title: string;
  sub: string;
  body: ReactNode;
}

/**
 * A card on the right of the stage (ADR-029) for the selected thing: it pops in when `item` is set,
 * shows what `face` makes of it, and plays a short leave when `item` is cleared (it keeps the last
 * item drawn meanwhile). `face` returning `null` (the item is gone) hides it at once.
 */
export function AsideCard<T>({
  item,
  keyOf,
  face,
  onClose,
  closeLabel,
}: {
  item: T | undefined;
  keyOf: (t: T) => string;
  face: (t: T) => CardFace | null;
  onClose: () => void;
  closeLabel: string;
}) {
  const [shown, setShown] = useState(item);
  const [leaving, setLeaving] = useState(false);
  const key = item === undefined ? "" : keyOf(item);

  useEffect(() => {
    if (item !== undefined) {
      setShown(item);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const id = setTimeout(() => {
      setShown(undefined);
      setLeaving(false);
    }, LEAVE_MS);
    return () => clearTimeout(id);
    // `key` identifies the item.
  }, [key]);

  // The item's contents can change without its key changing (an edit): draw the current one.
  const current = item ?? shown;
  if (current === undefined) return null;
  const f = face(current);
  if (!f) return null;
  return (
    <section className="obs-card" data-leaving={leaving || undefined} aria-label={`${f.sub}: ${f.title}`}>
      <header className="obs-card-head">
        <span className="obs-card-glyph">{f.glyph}</span>
        <span className="obs-card-titles">
          <h2 className="obs-card-title">{f.title}</h2>
          <span className="obs-card-kind">{f.sub}</span>
        </span>
        <button
          type="button"
          className="obs-icon-btn obs-card-close"
          aria-label={closeLabel}
          title={`${closeLabel} (Esc)`}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="obs-card-body" key={keyOf(current)}>
        {f.body}
      </div>
    </section>
  );
}
