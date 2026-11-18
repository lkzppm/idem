"use client";

import { useSyncExternalStore } from "react";
import { currentTheme } from "../theme-colors";

function subscribe(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** The resolved theme (`dark` | `light`), updated when the toggle or the system changes it. */
export function useResolvedTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribe, currentTheme, () => "dark");
}
