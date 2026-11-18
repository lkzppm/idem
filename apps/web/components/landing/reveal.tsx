"use client";

import { type CSSProperties, type ElementType, type ReactNode, useEffect, useRef } from "react";

/**
 * Rises its children into place the first time they scroll into view: hidden until its top edge
 * passes the lower 15% of the viewport. Reduced motion shows everything at once (globals.css).
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
}: {
  children: ReactNode;
  /** Seconds to wait before rising, for staggered groups. */
  delay?: number;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      el.classList.add("is-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("is-visible");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`reveal ${className}`} style={{ "--delay": `${delay}s` } as CSSProperties}>
      {children}
    </Tag>
  );
}
