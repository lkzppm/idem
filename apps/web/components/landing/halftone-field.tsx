"use client";

import { useEffect, useRef } from "react";
import { cappedDpr, onFramesReleased } from "@/lib/gpu/device";
import { useActive } from "@/lib/hooks/use-active";
import { useGpuGeneration } from "@/lib/hooks/use-gpu-generation";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useResolvedTheme } from "@/lib/hooks/use-theme";
import { Halftone } from "@/lib/landing/halftone";
import { PALETTES, type Palette } from "@/lib/theme-colors";
import { activeReveal, revealRadius } from "@/lib/theme-reveal";

/** Where the clock starts, so the first frame already has waves in it. */
const START = 14;
/** The pointer's follow: an underdamped spring, so the swell lags and wobbles a little (cartoon). */
const FOLLOW_W = 11;
const FOLLOW_Z = 0.55;
/** The swell pops in with a bounce and settles out when the pointer leaves. */
const PRESS_W = 14;
const PRESS_Z = 0.35;

/**
 * The hero's backdrop (`Halftone`): flat ink dots in slow posterized waves that swell around the
 * pointer. Progressive enhancement: the canvas fades in after its first frame; without WebGPU the
 * page background shows. Pauses offscreen and in hidden tabs; one still frame for reduced motion.
 */
export function HalftoneField() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useActive(wrap);
  const reduced = useReducedMotion();
  const theme = useResolvedTheme();
  /** Bumped when the WebGPU device is lost: the renderer below is then made again. */
  const gpu = useGpuGeneration();
  const palette = useRef<Palette>(PALETTES.dark);
  palette.current = PALETTES[theme];
  const s = useRef({
    halftone: null as Halftone | null,
    time: START,
    x: -1000,
    y: -1000,
    vx: 0,
    vy: 0,
    tx: -1000,
    ty: -1000,
    press: 0,
    vp: 0,
    pressTarget: 0,
  });

  const draw = () => {
    const st = s.current;
    if (!st.halftone) return;
    const frame = { time: st.time, pointer: [st.x, st.y] as [number, number], press: st.press };
    const rv = activeReveal();
    const box = canvas.current?.getBoundingClientRect();
    if (rv && box) {
      // Theme switch: the canvas paints the circle itself, old palette outside and new inside, in
      // step with the page's circle (the canvas is live above the page's snapshots meanwhile).
      st.halftone.draw(frame, PALETTES[rv.from], {
        x: rv.x - box.left,
        y: rv.y - box.top,
        r: revealRadius(rv),
        to: PALETTES[rv.to],
      });
      return;
    }
    st.halftone.draw(frame, palette.current);
  };

  // Renderer lifetime (made again after a lost GPU device).
  useEffect(() => {
    void gpu;
    const box = wrap.current;
    const el = canvas.current;
    if (!box || !el) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    const st = s.current;
    void Halftone.create(el)
      .then((halftone) => {
        if (!halftone) return;
        if (cancelled) {
          halftone.destroy();
          return;
        }
        st.halftone = halftone;
        const size = () => {
          const dpr = cappedDpr(2);
          const w = Math.max(1, Math.round(box.clientWidth * dpr));
          const h = Math.max(1, Math.round(box.clientHeight * dpr));
          el.width = w;
          el.height = h;
          halftone.resize(w, h, dpr);
          draw();
        };
        size();
        ro = new ResizeObserver(size);
        ro.observe(box);
        el.style.opacity = "1";
      })
      .catch((e: unknown) => {
        console.warn("[idem] halftone failed:", e);
      });
    return () => {
      cancelled = true;
      ro?.disconnect();
      st.halftone?.destroy();
      st.halftone = null;
    };
  }, [gpu]);

  useEffect(() => {
    draw();
  }, [theme]);

  // Frames held for the theme switch: draw again (in the new theme) once they are let go.
  useEffect(() => onFramesReleased(draw), []);

  // The pointer, on a fine pointer only.
  useEffect(() => {
    const box = wrap.current;
    const section = box?.parentElement;
    if (!box || !section || reduced || !window.matchMedia("(hover: hover) and (pointer: fine)").matches)
      return;
    const move = (ev: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const st = s.current;
      st.tx = ev.clientX - r.left;
      st.ty = ev.clientY - r.top;
      // Entering: the swell starts where the pointer is instead of flying in from afar.
      if (st.pressTarget === 0 && st.press < 0.05) {
        st.x = st.tx;
        st.y = st.ty;
        st.vx = 0;
        st.vy = 0;
      }
      st.pressTarget = 1;
    };
    const leave = () => {
      s.current.pressTarget = 0;
    };
    section.addEventListener("pointermove", move);
    section.addEventListener("pointerleave", leave);
    return () => {
      section.removeEventListener("pointermove", move);
      section.removeEventListener("pointerleave", leave);
    };
  }, [reduced]);

  useEffect(() => {
    if (!active || reduced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      const st = s.current;
      st.time += dt;
      const sub = Math.max(1, Math.ceil(dt * 240));
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        st.vx += (-FOLLOW_W * FOLLOW_W * (st.x - st.tx) - 2 * FOLLOW_Z * FOLLOW_W * st.vx) * h;
        st.vy += (-FOLLOW_W * FOLLOW_W * (st.y - st.ty) - 2 * FOLLOW_Z * FOLLOW_W * st.vy) * h;
        st.x += st.vx * h;
        st.y += st.vy * h;
        st.vp += (-PRESS_W * PRESS_W * (st.press - st.pressTarget) - 2 * PRESS_Z * PRESS_W * st.vp) * h;
        st.press += st.vp * h;
      }
      draw();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced]);

  return (
    <div ref={wrap} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas
        ref={canvas}
        className="halftone-canvas block h-full w-full opacity-0 transition-opacity duration-1000 ease-[var(--ease)]"
      />
    </div>
  );
}
