"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearLayout,
  defaultLayout,
  type Layout,
  loadLayout,
  type SandboxMode,
  saveLayout,
  type WindowId,
} from "@/lib/sandbox/layout";

/** The workspace layout for the current mode, with the operations the shell needs. */
export interface LayoutApi {
  layout: Layout;
  /** True once the saved layout was read (the first render uses the defaults). */
  loaded: boolean;
  isOpen(id: WindowId): boolean;
  open(id: WindowId): void;
  close(id: WindowId): void;
  toggle(id: WindowId): void;
  setSidebar(w: number): void;
  /** Remember the dock drawer's height. */
  setDock(h: number): void;
  /** Forget everything: the default panels and sizes. */
  reset(): void;
}

/**
 * Layout state: per-mode open panels, the sidebar width and the dock height, read from
 * `localStorage` after mount and written back (debounced) on change.
 */
export function useLayout(mode: SandboxMode): LayoutApi {
  const [layout, setLayout] = useState<Layout>(defaultLayout);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLayout(loadLayout());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => saveLayout(layout), 250);
    return () => clearTimeout(t);
  }, [layout, loaded]);

  const setOpen = useCallback(
    (id: WindowId, v: boolean) =>
      setLayout((l) =>
        (l.open[mode][id] === true) === v
          ? l
          : { ...l, open: { ...l.open, [mode]: { ...l.open[mode], [id]: v } } },
      ),
    [mode],
  );

  return useMemo<LayoutApi>(
    () => ({
      layout,
      loaded,
      isOpen: (id) => layout.open[mode][id] === true,
      open: (id) => setOpen(id, true),
      close: (id) => setOpen(id, false),
      toggle: (id) => setOpen(id, layout.open[mode][id] !== true),
      setSidebar: (w) => setLayout((l) => ({ ...l, sidebar: Math.round(w) })),
      setDock: (h) => setLayout((l) => ({ ...l, dock: Math.round(h) })),
      reset: () => {
        clearLayout();
        setLayout((l) => ({ ...defaultLayout(), sidebar: l.sidebar }));
      },
    }),
    [layout, loaded, mode, setOpen],
  );
}
