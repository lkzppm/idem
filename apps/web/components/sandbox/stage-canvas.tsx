"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cappedDpr } from "@/lib/gpu/device";
import { useActive } from "@/lib/hooks/use-active";
import { useGpuGeneration } from "@/lib/hooks/use-gpu-generation";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useResolvedTheme } from "@/lib/hooks/use-theme";
import { useMessages } from "@/lib/i18n/client";
import { sandbox } from "@/lib/i18n/messages/sandbox";
import { InstanceList, ShapeRenderer } from "@/lib/render/shapes";
import { type Rect, splitPanes } from "@/lib/sandbox/layout";
import { type SpringAxis, springSettled, stepSpring } from "@/lib/sandbox/motion";
import { innerFrame, nodeScale, type SceneNode, type TopologyScene } from "@/lib/sandbox/scene";
import { PALETTES } from "@/lib/theme-colors";

/** One network drawn on the stage: the live topology, or one run of the swarm comparison. */
export interface StagePane {
  key: string;
  scene: TopologyScene;
  /** Scene time for packets (virtual ms or real ms). */
  now: () => number;
  /** Nodes as laid out (re-render when the topology changes). */
  nodes: SceneNode[];
  title?: ReactNode;
  note?: ReactNode;
  /** Small HTML under a node's label (table counts). */
  badges?: Record<string, ReactNode>;
  /** Show agent ids under agents (when they fit). */
  agentLabels?: boolean;
}

type Frame = { x: SpringAxis; y: SpringAxis; w: SpringAxis; h: SpringAxis };

const axis = (v: number): SpringAxis => ({ x: v, v: 0, target: v });
const frameOf = (f: Frame): Rect => ({ x: f.x.x, y: f.y.x, w: f.w.x, h: f.h.x });

/**
 * The stage's network canvas: instanced SDF shapes on WebGPU (Canvas2D fallback), every pane in one
 * canvas, with node labels and pane titles as an HTML overlay moved by the same frame loop. Panes are
 * laid out in `area` (the part of the stage the windows leave free) and glide on a spring when it
 * changes. The scenes are mutated by their owner; this component draws them every frame while
 * visible and never re-renders React per frame.
 *
 * Keyboard: the nodes that `nodeAction` names are also invisible buttons over the canvas, one tab
 * stop for all of them (arrow keys, Home and End move between them, Enter or Space acts, focus shows
 * the node's path like a hover). If the renderer cannot be made, the stage retries on a fresh canvas
 * with Canvas2D, then says so; after a lost GPU device it is made again (`useGpuGeneration`).
 */
export function StageCanvas({
  panes,
  area,
  label,
  onNodeClick,
  nodeAction,
  onBackend,
}: {
  panes: StagePane[];
  area: Rect;
  /** Accessible description of the canvas. */
  label: string;
  onNodeClick?: (pane: string, node: string) => void;
  /**
   * What clicking a node does, as its accessible name (e.g. "agent-3: ask"), or `undefined` for a
   * node that does nothing. Named nodes are reachable with the keyboard.
   */
  nodeAction?: (pane: string, node: SceneNode) => string | undefined;
  onBackend?: (b: "webgpu" | "canvas2d") => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ShapeRenderer | null>(null);
  const size = useRef({ w: 1, h: 1 });
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState<"webgpu" | "canvas2d">();
  /** WebGPU failed after claiming the canvas: retry on a fresh canvas element, Canvas2D only. */
  const [plain, setPlain] = useState(false);
  /** Even Canvas2D failed: the stage says so instead of staying blank. */
  const [failed, setFailed] = useState(false);
  const gpu = useGpuGeneration();
  const t = useMessages(sandbox).shell;
  const active = useActive(wrap);
  const reduced = useReducedMotion();
  const theme = useResolvedTheme();
  const backendCb = useRef(onBackend);
  backendCb.current = onBackend;
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const frames = useRef(new Map<string, Frame>());
  const labels = useRef(new Map<string, HTMLElement>());
  const titles = useRef(new Map<string, HTMLElement>());
  const keys = useRef(new Map<string, HTMLButtonElement>());
  const [rove, setRove] = useState<string>();
  const dirty = useRef(true);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // Targets: the free area split into one pane per run.
  const targets = splitPanes(area, panes.length);
  const targetsKey = targets.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(";");
  useLayoutEffect(() => {
    void targetsKey;
    const seen = new Set<string>();
    panesRef.current.forEach((p, i) => {
      const t = targets[i];
      if (!t) return;
      seen.add(p.key);
      const f = frames.current.get(p.key);
      // New pane, reduced motion, or a stage that was not measured yet: no glide from nothing.
      if (!f || reducedRef.current || f.w.x < 2 || f.h.x < 2) {
        frames.current.set(p.key, { x: axis(t.x), y: axis(t.y), w: axis(t.w), h: axis(t.h) });
      } else {
        f.x.target = t.x;
        f.y.target = t.y;
        f.w.target = t.w;
        f.h.target = t.h;
      }
    });
    for (const k of frames.current.keys()) if (!seen.has(k)) frames.current.delete(k);
    dirty.current = true;
  }, [targetsKey]);

  // Overlay positions follow the frames: titles at each pane's corner, labels under each node.
  const place = useCallback(() => {
    for (const p of panesRef.current) {
      const f = frames.current.get(p.key);
      if (!f) continue;
      const fr = frameOf(f);
      const title = titles.current.get(p.key);
      if (title) title.style.transform = `translate3d(${fr.x + 18}px, ${fr.y + 14}px, 0)`;
      const k = p.scene.scaleFor(fr);
      for (const n of p.nodes) {
        const s = p.scene.screen(fr, n.id);
        if (!s) continue;
        const el = labels.current.get(`${p.key}:${n.id}`);
        if (el) {
          const dy = (n.kind === "agent" ? 9 : n.kind === "forwarder" ? 15 : 17) * k;
          el.style.transform = `translate3d(${s[0]}px, ${s[1] + dy}px, 0) translateX(-50%)`;
        }
        const key = keys.current.get(`${p.key}:${n.id}`);
        if (key) {
          // The node's hit radius (`TopologyScene.nodeAt`) plus a little room for the focus ring.
          const r = Math.max(8, (n.kind === "agent" ? 5 : n.kind === "forwarder" ? 10 : 12) * k + 3);
          key.style.width = `${2 * r}px`;
          key.style.height = `${2 * r}px`;
          key.style.transform = `translate3d(${s[0] - r}px, ${s[1] - r}px, 0)`;
        }
      }
    }
  }, []);

  useLayoutEffect(() => {
    place();
  });

  useEffect(() => {
    void gpu;
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    void ShapeRenderer.create(el, !plain)
      .then((r) => {
        if (cancelled) {
          r.destroy();
          return;
        }
        renderer.current = r;
        setBackend(r.backend);
        backendCb.current?.(r.backend);
        const fit = () => {
          const dpr = cappedDpr(2);
          const w = box.clientWidth;
          const h = box.clientHeight;
          size.current = { w, h };
          el.width = Math.max(1, Math.round(w * dpr));
          el.height = Math.max(1, Math.round(h * dpr));
          r.resize(w, h, dpr);
        };
        fit();
        ro = new ResizeObserver(fit);
        ro.observe(box);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.warn("[idem] stage renderer failed:", e);
        // A canvas that has a WebGPU context never gets a 2D one: a new canvas element (keyed on
        // `plain`) gets the Canvas2D retry.
        if (!plain) setPlain(true);
        else setFailed(true);
      });
    return () => {
      cancelled = true;
      ro?.disconnect();
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [plain, gpu]);

  useEffect(() => {
    if (!ready || !active) return;
    const list = new InstanceList();
    const pal = PALETTES[theme];
    let raf = 0;
    let last = performance.now();
    const tick = () => {
      const real = performance.now();
      const dt = Math.min(0.05, (real - last) / 1000);
      last = real;
      let moving = false;
      for (const f of frames.current.values()) {
        for (const a of [f.x, f.y, f.w, f.h]) {
          if (springSettled(a)) {
            a.x = a.target;
            a.v = 0;
          } else {
            stepSpring(a, dt, 0.5, 0.86);
            moving = true;
          }
        }
      }
      if (moving || dirty.current) {
        place();
        dirty.current = false;
      }
      const r = renderer.current;
      if (r) {
        list.clear();
        const ps = panesRef.current;
        const agents = ps.reduce((n, p) => n + p.nodes.filter((x) => x.kind === "agent").length, 0);
        const opts = { reduced, dense: r.backend === "canvas2d" && agents > 24 };
        let prev: Rect | undefined;
        for (const p of ps) {
          const f = frames.current.get(p.key);
          if (!f) continue;
          const fr = frameOf(f);
          if (prev) separator(list, fr, fr.x > prev.x + 1, pal.fg);
          p.scene.build(list, fr, pal, p.now(), real, opts);
          prev = fr;
        }
        r.draw(list, 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, active, theme, reduced, place]);

  // Pointer: hover a node to see its path to the producer, click to act on it.
  const hit = (e: ReactPointerEvent | ReactMouseEvent): { pane: StagePane; node: string } | undefined => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return undefined;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    for (const p of panesRef.current) {
      const f = frames.current.get(p.key);
      if (!f) continue;
      const fr = frameOf(f);
      if (x < fr.x || x > fr.x + fr.w || y < fr.y || y > fr.y + fr.h) continue;
      const node = p.scene.nodeAt(fr, x, y);
      if (node) return { pane: p, node };
    }
    return undefined;
  };
  const onMove = (e: ReactPointerEvent) => {
    if (e.pointerType === "touch") return;
    const h = hit(e);
    for (const p of panesRef.current) p.scene.hover = h?.pane === p ? h.node : undefined;
    if (wrap.current) wrap.current.style.cursor = h && onNodeClick ? "pointer" : "";
  };
  const onLeave = () => {
    for (const p of panesRef.current) p.scene.hover = undefined;
  };
  const onClick = (e: ReactMouseEvent) => {
    const h = hit(e);
    if (h) onNodeClick?.(h.pane.key, h.node);
  };

  // Keyboard: the nodes `nodeAction` names, in pane order, as one roving group.
  const actionable = nodeAction
    ? panes.flatMap((p) =>
        p.nodes.flatMap((n) => {
          const name = nodeAction(p.key, n);
          return name ? [{ id: `${p.key}:${n.id}`, pane: p.key, node: n.id, name }] : [];
        }),
      )
    : [];
  const roving = actionable.some((a) => a.id === rove) ? rove : actionable[0]?.id;
  const showPath = (pane?: string, node?: string) => {
    for (const p of panesRef.current) p.scene.hover = p.key === pane ? node : undefined;
  };
  const onNodeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = actionable.findIndex((a) => a.id === roving);
    const last = actionable.length - 1;
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? Math.min(last, i + 1)
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? Math.max(0, i - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    const next = actionable[to];
    if (!next) return;
    e.preventDefault();
    setRove(next.id);
    keys.current.get(next.id)?.focus();
  };

  return (
    <div
      ref={wrap}
      className="obs-canvas"
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onClick={onClick}
      data-backend={backend}
    >
      <canvas
        key={plain ? "plain" : "gpu"}
        ref={canvas}
        role="img"
        aria-label={label}
        className="absolute inset-0 h-full w-full"
      />
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {panes.map((p) => {
          const f = frames.current.get(p.key);
          const fr = f ? frameOf(f) : targets[0];
          const inner = fr ? innerFrame(fr) : undefined;
          const agentCount = p.nodes.filter((n) => n.kind === "agent").length;
          const agentsFit = inner ? inner.h / Math.max(1, agentCount) >= 16 : false;
          return (
            <div key={p.key}>
              {(p.title || p.note) && (
                <div
                  ref={(el) => {
                    if (el) titles.current.set(p.key, el);
                    else titles.current.delete(p.key);
                  }}
                  className="obs-pane-title"
                >
                  {p.title && <span className="obs-pane-name">{p.title}</span>}
                  {p.note && <span className="obs-pane-note">{p.note}</span>}
                </div>
              )}
              {p.nodes.map((n) => {
                const show = n.kind !== "agent" || ((p.agentLabels ?? true) && agentsFit);
                const badge = p.badges?.[n.id];
                if (!show && !badge) return null;
                return (
                  <div
                    key={n.id}
                    ref={(el) => {
                      const k = `${p.key}:${n.id}`;
                      if (el) labels.current.set(k, el);
                      else labels.current.delete(k);
                    }}
                    className="obs-node-label"
                    data-kind={n.kind}
                  >
                    {show && <span>{n.kind === "agent" ? n.id.replace("agent-", "a") : n.id}</span>}
                    {badge}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {actionable.length > 0 && (
        <div className="obs-node-keys" role="group" aria-label={t.nodes} onKeyDown={onNodeKey}>
          {actionable.map((a) => (
            <button
              key={a.id}
              ref={(el) => {
                if (el) keys.current.set(a.id, el);
                else keys.current.delete(a.id);
              }}
              type="button"
              className="obs-node-key"
              style={{ borderRadius: "50%" }}
              aria-label={a.name}
              tabIndex={a.id === roving ? 0 : -1}
              onFocus={() => {
                setRove(a.id);
                showPath(a.pane, a.node);
              }}
              onBlur={() => showPath()}
              onClick={(e) => {
                e.stopPropagation();
                onNodeClick?.(a.pane, a.node);
              }}
            />
          ))}
        </div>
      )}
      {failed && (
        <div className="obs-stage-card" role="alert">
          <p className="text-[13px] text-muted">{t.stageFailed}</p>
        </div>
      )}
    </div>
  );
}

/** A dashed rule along the edge a pane shares with the one before it. */
function separator(
  list: InstanceList,
  fr: Rect,
  vertical: boolean,
  ink: [number, number, number, number],
): void {
  const len = vertical ? fr.h : fr.w;
  for (let s = 24; s < len - 24; s += 11) {
    const e = Math.min(len - 24, s + 6);
    if (vertical) list.capsule(fr.x, fr.y + s, fr.x, fr.y + e, 0.6, ink, 0.22);
    else list.capsule(fr.x + s, fr.y, fr.x + e, fr.y, 0.6, ink, 0.22);
  }
}
