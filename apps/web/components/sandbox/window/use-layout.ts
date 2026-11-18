"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearLayout,
  defaultLayout,
  type Layout,
  loadLayout,
  type Rect,
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
  isCollapsed(id: WindowId): boolean;
  /** z-order index (0 = back). */
  z(id: WindowId): number;
  frontmost(): WindowId | undefined;
  open(id: WindowId): void;
  close(id: WindowId): void;
  toggle(id: WindowId): void;
  front(id: WindowId): void;
  setCollapsed(id: WindowId, v: boolean): void;
  /** Remember where the visitor put a window. */
  place(id: WindowId, r: Rect): void;
  setSidebar(w: number): void;
  /** Forget everything: default windows in default places. */
  reset(): void;
}

/**
 * Layout state: per-mode open windows, collapsed windows, stacking order, moved rectangles and the
 * sidebar width, read from `localStorage` after mount and written back (debounced) on change.
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

  const front = useCallback((id: WindowId) => {
    setLayout((l) =>
      l.order[l.order.length - 1] === id ? l : { ...l, order: [...l.order.filter((x) => x !== id), id] },
    );
  }, []);
  const setOpen = useCallback(
    (id: WindowId, v: boolean) => {
      setLayout((l) => ({
        ...l,
        open: { ...l.open, [mode]: { ...l.open[mode], [id]: v } },
        order: v ? [...l.order.filter((x) => x !== id), id] : l.order,
        collapsed: v ? { ...l.collapsed, [id]: false } : l.collapsed,
      }));
    },
    [mode],
  );

  return useMemo<LayoutApi>(
    () => ({
      layout,
      loaded,
      isOpen: (id) => layout.open[mode][id] === true,
      isCollapsed: (id) => layout.collapsed[id] === true,
      z: (id) => layout.order.indexOf(id),
      frontmost: () => [...layout.order].reverse().find((id) => layout.open[mode][id] === true),
      open: (id) => setOpen(id, true),
      close: (id) => setOpen(id, false),
      toggle: (id) => setOpen(id, layout.open[mode][id] !== true),
      front,
      setCollapsed: (id, v) => setLayout((l) => ({ ...l, collapsed: { ...l.collapsed, [id]: v } })),
      place: (id, r) =>
        setLayout((l) => ({
          ...l,
          rects: {
            ...l.rects,
            [id]: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
          },
        })),
      setSidebar: (w) => setLayout((l) => ({ ...l, sidebar: Math.round(w) })),
      reset: () => {
        clearLayout();
        setLayout((l) => ({ ...defaultLayout(), sidebar: l.sidebar }));
      },
    }),
    [layout, loaded, mode, setOpen, front],
  );
}
