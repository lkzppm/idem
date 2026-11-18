"use client";

import { useEffect, useRef } from "react";
import { cappedDpr, onFramesReleased } from "@/lib/gpu/device";
import { useActive } from "@/lib/hooks/use-active";
import { useGpuGeneration } from "@/lib/hooks/use-gpu-generation";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useResolvedTheme } from "@/lib/hooks/use-theme";
import { Globe, REST, type View } from "@/lib/landing/globe";
import { InstanceList, ShapeRenderer } from "@/lib/render/shapes";
import { PALETTES, type Palette } from "@/lib/theme-colors";
import { activeReveal, revealRadius } from "@/lib/theme-reveal";

/** The globe's own turn (rad/s); a flick hands over its speed, which relaxes back to this. */
const SPIN = -0.045;
/** How fast a flicked spin relaxes back to `SPIN` (1/s). */
const RELAX = 0.9;
/** Pitch springs home: critically damped, this angular frequency (rad/s). */
const RETURN = 2.2;
const MAX_PITCH = 0.9;
/** Movement (px) before a press becomes a drag instead of a click. */
const SLOP = 5;

/**
 * The hero's network: half a globe on the right edge, turning on its own, with the protocol running
 * on it (`Globe`). Drag to spin it (the release velocity carries into the spin, interruptible at
 * any moment); hover a node to see its path to the producer; click a node to make it ask; click open
 * globe to add a node. Pauses offscreen and in hidden tabs; reduced motion draws still frames that
 * still respond to clicks. Decorative (`aria-hidden`), and no text inside.
 */
export function GlobeField() {
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
    renderer: null as ShapeRenderer | null,
    globe: null as Globe | null,
    list: new InstanceList(),
    /** The second palette's frame while the theme switch's circle crosses the globe. */
    next: new InstanceList(),
    w: 0,
    h: 0,
    yaw: REST.yaw,
    pitchOff: 0,
    vYaw: SPIN,
    vPitch: 0,
    drag: null as null | {
      id: number;
      x0: number;
      y0: number;
      x: number;
      y: number;
      moved: boolean;
      hist: { x: number; y: number; t: number }[];
    },
  });

  const view = (): View => {
    const st = s.current;
    const wide = st.w >= 768;
    // Half a globe: the centre sits on the right edge (on a phone, on the bottom edge).
    // On a desk it is centred vertically and as large as fits the hero's height (never cut at the
    // top or bottom); it sits a quarter past the right edge, so about the same width shows.
    const r = wide ? Math.min(st.h * 0.49, st.w * 0.38) : st.w * 0.78;
    return {
      cx: wide ? st.w - r * 0.25 : st.w * 0.5,
      cy: wide ? st.h * 0.5 : st.h + r * 0.12,
      r,
      yaw: st.yaw,
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, REST.pitch + st.pitchOff)),
    };
  };

  const render = () => {
    const st = s.current;
    if (!st.renderer || !st.globe) return;
    const v = view();
    const rv = activeReveal();
    const box = canvas.current?.getBoundingClientRect();
    if (rv && box) {
      // Theme switch: this canvas is live above the page's still snapshot, so it paints the
      // circle itself, old palette outside and new inside, in step with the page's circle.
      const mask = { x: rv.x - box.left, y: rv.y - box.top, r: revealRadius(rv) };
      st.globe.draw(st.list, v, PALETTES[rv.from]);
      st.globe.draw(st.next, v, PALETTES[rv.to]);
      st.renderer.drawLayers([
        { list: st.list, mask: { ...mask, keep: "outside" } },
        { list: st.next, mask: { ...mask, keep: "inside" } },
      ]);
      return;
    }
    st.globe.draw(st.list, v, palette.current);
    st.renderer.draw(st.list);
  };

  // Renderer and globe lifetime (made again after a lost GPU device).
  useEffect(() => {
    void gpu;
    const box = wrap.current;
    const el = canvas.current;
    if (!box || !el) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    const st = s.current;
    void ShapeRenderer.create(el)
      .then((renderer) => {
        if (cancelled) {
          renderer.destroy();
          return;
        }
        st.renderer = renderer;
        const globe = new Globe();
        // Start mid-conversation: some edges already hold answers.
        for (let i = 0; i < (reduced ? 420 : 150); i++) globe.step(1 / 30);
        st.globe = globe;
        const size = () => {
          st.w = box.clientWidth;
          st.h = box.clientHeight;
          const dpr = cappedDpr(2);
          el.width = Math.max(1, Math.round(st.w * dpr));
          el.height = Math.max(1, Math.round(st.h * dpr));
          renderer.resize(st.w, st.h, dpr);
          render();
        };
        size();
        ro = new ResizeObserver(size);
        ro.observe(box);
        el.style.opacity = "1";
      })
      .catch((e: unknown) => {
        // E.g. no new device after a loss, on a canvas that already has a WebGPU context.
        console.warn("[idem] globe renderer failed:", e);
      });
    return () => {
      cancelled = true;
      ro?.disconnect();
      st.renderer?.destroy();
      st.renderer = null;
      st.globe = null;
    };
  }, [reduced, gpu]);

  useEffect(() => {
    render();
  }, [theme]);

  // Frames held for the theme switch: draw again (in the new theme) once they are let go.
  useEffect(() => onFramesReleased(render), []);

  // The loop: the network runs, the globe turns, a flick coasts and settles back to the turn.
  useEffect(() => {
    if (!active || reduced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const st = s.current;
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      st.globe?.step(dt);
      if (!st.drag) {
        st.vYaw += (SPIN - st.vYaw) * (1 - Math.exp(-dt * RELAX));
        st.yaw += st.vYaw * dt;
        st.vPitch += (-RETURN * RETURN * st.pitchOff - 2 * RETURN * st.vPitch) * dt;
        st.pitchOff += st.vPitch * dt;
      }
      render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced]);

  // Pointer: hover, drag to spin, click to ask or to add a node.
  useEffect(() => {
    const box = wrap.current;
    const section = box?.parentElement;
    if (!box || !section) return;
    const local = (ev: PointerEvent) => {
      const r = box.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const onGlobe = (x: number, y: number) => {
      const v = view();
      return Math.hypot(x - v.cx, y - v.cy) < v.r;
    };
    const interactive = (ev: PointerEvent) =>
      Boolean((ev.target as Element | null)?.closest("a, button, input, select, textarea, [role=button]"));
    // With reduced motion there is no loop: let the model settle, then draw the new still frame.
    const still = () => {
      if (!reduced) return;
      const g = s.current.globe;
      if (g) for (let i = 0; i < 90; i++) g.step(1 / 30);
      render();
    };
    const setCursor = (c: string) => {
      if (section.style.cursor !== c) section.style.cursor = c;
    };

    const down = (ev: PointerEvent) => {
      if (interactive(ev) || ev.button !== 0) return;
      const p = local(ev);
      if (!onGlobe(p.x, p.y)) return;
      const st = s.current;
      // Grabbing a turning globe stops it where it is; the spin continues from here.
      st.vYaw = 0;
      st.vPitch = 0;
      st.drag = {
        id: ev.pointerId,
        x0: p.x,
        y0: p.y,
        x: p.x,
        y: p.y,
        moved: false,
        hist: [{ ...p, t: ev.timeStamp }],
      };
      if (ev.pointerType !== "touch") {
        section.setPointerCapture(ev.pointerId);
        setCursor("grabbing");
      }
    };
    const move = (ev: PointerEvent) => {
      const st = s.current;
      const p = local(ev);
      const d = st.drag;
      if (!d || d.id !== ev.pointerId) {
        if (ev.pointerType !== "mouse") return;
        const g = st.globe;
        const over = !interactive(ev) && onGlobe(p.x, p.y);
        const hit = g ? g.hoverAt(over ? view() : null, p.x, p.y) : -1;
        if (reduced) render();
        setCursor(hit >= 0 ? "pointer" : over ? "grab" : "");
        return;
      }
      if (ev.pointerType === "touch") return; // a finger scrolls the page; a tap still counts
      if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) > SLOP) {
        d.moved = true;
        st.globe?.hoverAt(null);
      }
      if (!d.moved) return;
      const r = view().r;
      st.yaw -= (p.x - d.x) / r;
      st.pitchOff = Math.max(
        -MAX_PITCH - REST.pitch,
        Math.min(MAX_PITCH - REST.pitch, st.pitchOff + (p.y - d.y) / r),
      );
      d.x = p.x;
      d.y = p.y;
      d.hist.push({ ...p, t: ev.timeStamp });
      while (d.hist.length > 2 && ev.timeStamp - (d.hist[0]?.t ?? 0) > 90) d.hist.shift();
      if (reduced || !active) render();
    };
    const up = (ev: PointerEvent) => {
      const st = s.current;
      const d = st.drag;
      if (!d || d.id !== ev.pointerId) return;
      st.drag = null;
      const p = local(ev);
      setCursor(onGlobe(p.x, p.y) ? "grab" : "");
      if (ev.type === "pointercancel") return;
      if (!d.moved) {
        const g = st.globe;
        if (!g) return;
        const v = view();
        const hit = g.nodeAt(v, d.x0, d.y0, ev.pointerType === "touch" ? 22 : 14);
        if (hit >= 0) g.poke(hit);
        else g.place(v, d.x0, d.y0);
        st.vYaw = SPIN;
        still();
        return;
      }
      // Hand the pointer's velocity to the spin, so there is no seam between drag and coast.
      const a = d.hist[0];
      const b = d.hist[d.hist.length - 1];
      if (a && b && b.t > a.t && ev.timeStamp - b.t < 80) {
        const r = view().r;
        const dt = (b.t - a.t) / 1000;
        st.vYaw = -((b.x - a.x) / r) / dt;
        st.vPitch = (b.y - a.y) / r / dt;
      }
    };
    const leave = () => {
      s.current.globe?.hoverAt(null);
      if (reduced) render();
    };
    section.addEventListener("pointerdown", down);
    section.addEventListener("pointermove", move);
    section.addEventListener("pointerup", up);
    section.addEventListener("pointercancel", up);
    section.addEventListener("pointerleave", leave);
    return () => {
      section.removeEventListener("pointerdown", down);
      section.removeEventListener("pointermove", move);
      section.removeEventListener("pointerup", up);
      section.removeEventListener("pointercancel", up);
      section.removeEventListener("pointerleave", leave);
    };
  }, [reduced, active]);

  return (
    <div ref={wrap} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas
        ref={canvas}
        className="globe-canvas block h-full w-full opacity-0 transition-opacity duration-1000 ease-[var(--ease)]"
      />
    </div>
  );
}
