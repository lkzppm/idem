"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * Marks its figure `is-in` the first time it scrolls into view, which starts the entrance of the
 * marks inside (app/styles/results.css). Without scripts, or with reduced motion, everything is
 * simply there: the hidden state only applies under `.js` and outside `prefers-reduced-motion`.
 */
export function InView({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <figure ref={ref} className={`r-figure r-enter ${className}`}>
      {children}
    </figure>
  );
}
