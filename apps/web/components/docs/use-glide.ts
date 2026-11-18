"use client";

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Where the gliding indicator sits inside its list, and which way it last moved. */
export interface Glide {
  /** Distance from the list's top edge to the active item's top edge. */
  top: number;
  /** Distance from the active item's bottom edge to the list's bottom edge. */
  bottom: number;
  /** The direction of the last move: the leading edge travels first, the other one catches up. */
  dir: "up" | "down";
  /** Measured at least once and painted in place: from here on, moves animate. */
  ready: boolean;
  /** There is an active item to point at. */
  visible: boolean;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Measures the active item of a list (the first match of `selector` inside `list`) so one
 * indicator can glide between items instead of jumping. The indicator is positioned by its top and
 * bottom edges; CSS gives the leading edge a shorter spring than the trailing one, so it stretches
 * as it leaves and settles with a small bounce. Both are plain transitions, so a move interrupted
 * by another one simply retargets from where it is.
 *
 * `key` is whatever changes when the active item does (the pathname, the heading in view).
 *
 * A list that is not rendered (inside the closed docs drawer, a hidden rail) is not measured: its
 * box is empty, and an indicator placed from it would glide in from the whole list when the list
 * shows. While hidden the indicator is not `ready`, so its first real position is painted without a
 * transition, and moves animate from the next frame on.
 */
export function useGlide(list: RefObject<HTMLElement | null>, selector: string, key: unknown): Glide {
  const [glide, setGlide] = useState<Glide>({ top: 0, bottom: 0, dir: "down", ready: false, visible: false });
  const lastTop = useRef<number | undefined>(undefined);
  /** The frame that turns `ready` on after the first real measure (0: none pending). */
  const readyFrame = useRef(0);

  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    if (el.getClientRects().length === 0) {
      // Not rendered: forget the last position, so the next one is placed, not animated.
      cancelAnimationFrame(readyFrame.current);
      readyFrame.current = 0;
      lastTop.current = undefined;
      setGlide((g) => (g.ready ? { ...g, ready: false } : g));
      return;
    }
    const item = el.querySelector<HTMLElement>(selector);
    if (!item) {
      setGlide((g) => (g.visible ? { ...g, visible: false } : g));
      return;
    }
    const box = el.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const top = Math.round(r.top - box.top);
    const bottom = Math.round(box.bottom - r.bottom);
    const prev = lastTop.current;
    lastTop.current = top;
    setGlide((g) => {
      const dir = prev === undefined || top === prev ? g.dir : top > prev ? "down" : "up";
      if (g.visible && g.top === top && g.bottom === bottom && g.dir === dir) return g;
      return { ...g, top, bottom, dir, visible: true };
    });
    // The first position is painted without a transition; moves animate only after that.
    if (readyFrame.current === 0) {
      readyFrame.current = requestAnimationFrame(() =>
        setGlide((g) => (g.ready ? g : { ...g, ready: true })),
      );
    }
  }, [list, selector]);

  useIsoLayoutEffect(() => {
    measure();
  }, [measure, key]);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Web fonts change the items' heights after the first measure.
    void document.fonts?.ready.then(measure);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(readyFrame.current);
      readyFrame.current = 0;
    };
  }, [list, measure]);

  return glide;
}
