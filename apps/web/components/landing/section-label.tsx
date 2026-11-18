import type { ReactNode } from "react";
import { MARK_ANSWER, MARK_REQUEST } from "@/components/brand/mark";

/**
 * A section's label: the IDEM mark in small and a few words in Outfit, sentence case. Inside a
 * `Reveal`, the two harpoons arrive from opposite sides and meet with a springy overshoot (a request
 * and its answer becoming "the same", the mark's own meaning); elsewhere, and under reduced motion,
 * they simply sit there. `.eyebrow` in globals.css sets the type; `.t-eyebrow` is the same label
 * drawn with CSS alone, for pages that only need the text.
 */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`eyebrow ${className}`}>
      <svg viewBox="4 4 24 24" aria-hidden="true" className="eyebrow-mark">
        <path d={MARK_REQUEST} className="eyebrow-i" />
        <path d={MARK_ANSWER} className="eyebrow-d" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
