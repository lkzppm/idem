"use client";

import { type RefObject, useEffect, useState } from "react";

/**
 * True while the element is on screen and the tab is visible. Render loops pause otherwise, so
 * nothing burns GPU time in the background.
 */
export function useActive(ref: RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setOnScreen(e.isIntersecting);
    });
    io.observe(el);
    const onVis = () => setVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ref]);
  return onScreen && visible;
}
