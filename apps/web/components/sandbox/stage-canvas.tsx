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
import { InstanceList, type Layer, ShapeRenderer } from "@/lib/render/shapes";
import { type Rect, splitPanes } from "@/lib/sandbox/layout";
import { type SpringAxis, springSettled, stepSpring } from "@/lib/sandbox/motion";
import {
  type Camera,
  innerFrame,
  MAX_ZOOM,
  MIN_ZOOM,
  nodeScale,
  type SceneNode,
  type TopologyScene,
} from "@/lib/sandbox/scene";
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

/** What the network editor has selected on the stage. */
export type EditorSelection = { kind: "node"; id: string } | { kind: "link"; id: string };

/** Calls the stage offers its editor owner (dropping a palette chip needs a world position). */
export interface StageEditorHandle {
  /** World point under a client (viewport) position, in the first pane; `undefined` off the stage. */
  worldAt(clientX: number, clientY: number): [number, number] | undefined;
  /** World point at the middle of the first pane. */
  center(): [number, number];
}

/**
 * Turns the stage into the network editor: nodes keep world positions and are drawn through
 * `camera` (one object shared by every pane, mutated in place), and the pointer edits the network.
 * Drag a node to move it (Shift: to link it), drag empty space to pan, scroll or pinch to zoom,
 * click a node or a link to select it, drag from the selected node's handle onto another node to
 * link them.
 */
export interface StageEditor {
  camera: Camera;
  /** Changing it fits the camera to the network. */
  fitKey: number;
  selected: EditorSelection | undefined;
  onSelect(sel: EditorSelection | undefined): void;
  /** A node moved to world (x, y); `done` on release (commit), otherwise while dragging. */
  onMove(id: string, x: number, y: number, done: boolean): void;
  canLink(a: string, b: string): boolean;
  onLink(a: string, b: string): void;
  /** The id of the link drawn between `a` and `b`. */
  linkId(a: string, b: string): string | undefined;
  handle: { current: StageEditorHandle | null };
  labels: { zoomIn: string; zoomOut: string; fit: string; connect: (id: string) => string; empty: string };
}

type Gesture =
  | { type: "node"; id: string; pane: string; sx: number; sy: number; dx: number; dy: number; moved: boolean }
  | { type: "pan"; pane: string | undefined; sx: number; sy: number; lx: number; ly: number; moved: boolean }
  | { type: "link"; from: string; pane: string; sx: number; sy: number }
  | { type: "pinch"; d0: number; z0: number; cx: number; cy: number };

const DRAG_PX = 4;

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
  editor,
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
  /** The network editor's hooks; without them the stage only hovers and clicks. */
  editor?: StageEditor;
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
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, [number, number]>());
  const handleEl = useRef<HTMLButtonElement>(null);

  // Targets: the free area split into one pane per run.
  const targets = splitPanes(area, panes.length);
  // The pane keys too: no pane and one pane split the area the same way, and a pane that appears
  // later still needs its frame.
  const targetsKey = `${panes.map((p) => p.key).join(",")}|${targets
    .map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`)
    .join(";")}`;
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
        const ed = editorRef.current;
        if (ed && p === panesRef.current[0] && ed.selected?.kind === "node" && ed.selected.id === n.id) {
          const h = handleEl.current;
          const r = (n.kind === "agent" ? 6 : n.kind === "forwarder" ? 11 : 13) * k;
          if (h) h.style.transform = `translate3d(${s[0] + r + 6}px, ${s[1] - r - 18}px, 0)`;
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
    const lists: InstanceList[] = [];
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
      if (moving || dirty.current || editorRef.current) {
        place();
        dirty.current = false;
      }
      const r = renderer.current;
      if (r) {
        const ps = panesRef.current;
        const agents = ps.reduce((n, p) => n + p.nodes.filter((x) => x.kind === "agent").length, 0);
        const opts = { reduced, dense: r.backend === "canvas2d" && agents > 24 };
        // One layer per pane, clipped to it when there are several (the editor's camera can carry a
        // pane's network past its edge).
        while (lists.length < Math.max(1, ps.length)) lists.push(new InstanceList());
        const layers: Layer[] = [];
        let prev: Rect | undefined;
        ps.forEach((p, i) => {
          const f = frames.current.get(p.key);
          const l = lists[i] as InstanceList;
          l.clear();
          if (!f) return;
          const fr = frameOf(f);
          if (prev) separator(l, fr, fr.x > prev.x + 1, pal.fg);
          p.scene.build(l, fr, pal, p.now(), real, opts);
          layers.push(ps.length > 1 ? { list: l, clip: fr } : { list: l });
          prev = fr;
        });
        r.drawLayers(layers, 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, active, theme, reduced, place]);

  // Pointer: hover a node to see its path to the producer, click to act on it.
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = wrap.current?.getBoundingClientRect();
    return box ? [e.clientX - box.left, e.clientY - box.top] : [0, 0];
  };
  const paneAt = (x: number, y: number): { pane: StagePane; fr: Rect } | undefined => {
    for (const p of panesRef.current) {
      const f = frames.current.get(p.key);
      if (!f) continue;
      const fr = frameOf(f);
      if (x >= fr.x && x <= fr.x + fr.w && y >= fr.y && y <= fr.y + fr.h) return { pane: p, fr };
    }
    return undefined;
  };
  const frameFor = (key: string): Rect | undefined => {
    const f = frames.current.get(key);
    return f ? frameOf(f) : undefined;
  };
  const hit = (e: { clientX: number; clientY: number }): { pane: StagePane; node: string } | undefined => {
    const [x, y] = local(e);
    const at = paneAt(x, y);
    const node = at?.pane.scene.nodeAt(at.fr, x, y);
    return at && node ? { pane: at.pane, node } : undefined;
  };
  const scenes = () => panesRef.current.map((p) => p.scene);
  const zoomAt = (sx: number, sy: number, factor: number) => {
    const ed = editorRef.current;
    const at =
      paneAt(sx, sy) ??
      (panesRef.current[0] && { pane: panesRef.current[0], fr: frameFor(panesRef.current[0].key) });
    if (!ed || !at?.fr) return;
    const [wx, wy] = at.pane.scene.toWorld(at.fr, sx, sy);
    const c = ed.camera;
    c.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
    c.x = wx - (sx - at.fr.x - at.fr.w / 2) / c.zoom;
    c.y = wy - (sy - at.fr.y - at.fr.h / 2) / c.zoom;
  };
  const zoomCenter = (factor: number) => {
    const p = panesRef.current[0];
    const fr = p && frameFor(p.key);
    if (fr) zoomAt(fr.x + fr.w / 2, fr.y + fr.h / 2, factor);
  };

  // The editor's handle for palette drops, and fitting the camera when asked.
  useEffect(() => {
    if (!editor) return;
    editor.handle.current = {
      worldAt: (cx, cy) => {
        const [x, y] = local({ clientX: cx, clientY: cy });
        const p = panesRef.current[0];
        const fr = p && frameFor(p.key);
        if (!p || !fr) return undefined;
        const box = wrap.current?.getBoundingClientRect();
        if (!box || x < 0 || y < 0 || x > box.width || y > box.height) return undefined;
        return p.scene.toWorld(paneAt(x, y)?.fr ?? fr, x, y);
      },
      center: () => [editorRef.current?.camera.x ?? 0, editorRef.current?.camera.y ?? 0],
    };
    return () => {
      editor.handle.current = null;
    };
  }, [editor?.handle, editor]);
  const fitKey = editor?.fitKey;
  useLayoutEffect(() => {
    if (fitKey === undefined) return;
    const p = panesRef.current[0];
    const fr = targets[0];
    if (p && fr && fr.w > 2) p.scene.fit(fr);
    // Fit on request, once the first pane has a size, and when the panes split or join.
  }, [fitKey, (targets[0]?.w ?? 0) > 2, panes.length]);

  // The editor's selection, shown by every pane's scene.
  useEffect(() => {
    const sel = editor?.selected;
    for (const p of panes) {
      if (!editor) continue;
      p.scene.selected = sel?.kind === "node" ? sel.id : undefined;
      p.scene.selectedLink =
        sel?.kind === "link"
          ? p.scene.links.findIndex(([a, b]) => editor.linkId(a, b) === sel.id)
          : undefined;
      if (p.scene.selectedLink === -1) p.scene.selectedLink = undefined;
    }
  });

  // Wheel: pinch (ctrl) or a mouse wheel zooms around the pointer; a trackpad's two-finger scroll pans.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !editor) return;
    const onWheel = (e: WheelEvent) => {
      const ed = editorRef.current;
      if (!ed) return;
      e.preventDefault();
      const [sx, sy] = local(e);
      const mouse =
        e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouse) {
        const scale = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0022;
        zoomAt(sx, sy, Math.exp(-e.deltaY * scale));
      } else {
        ed.camera.x += e.deltaX / ed.camera.zoom;
        ed.camera.y += e.deltaY / ed.camera.zoom;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editor !== undefined]);

  const endDraft = () => {
    for (const sc of scenes()) sc.draft = undefined;
  };

  const onDown = (e: ReactPointerEvent) => {
    const ed = editorRef.current;
    if (!ed || (e.button !== 0 && e.pointerType === "mouse")) return;
    if ((e.target as HTMLElement).closest("button, a, input, select")) return;
    const [x, y] = local(e);
    pointers.current.set(e.pointerId, [x, y]);
    wrap.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [[number, number], [number, number]];
      endDraft();
      gesture.current = {
        type: "pinch",
        d0: Math.hypot(a[0] - b[0], a[1] - b[1]),
        z0: ed.camera.zoom,
        cx: (a[0] + b[0]) / 2,
        cy: (a[1] + b[1]) / 2,
      };
      return;
    }
    const at = paneAt(x, y);
    const node = at?.pane.scene.nodeAt(at.fr, x, y);
    if (at && node && e.shiftKey) {
      gesture.current = { type: "link", from: node, pane: at.pane.key, sx: x, sy: y };
    } else if (at && node) {
      const n = at.pane.scene.nodes.get(node);
      const [wx, wy] = at.pane.scene.toWorld(at.fr, x, y);
      gesture.current = {
        type: "node",
        id: node,
        pane: at.pane.key,
        sx: x,
        sy: y,
        dx: (n?.x ?? wx) - wx,
        dy: (n?.y ?? wy) - wy,
        moved: false,
      };
    } else {
      gesture.current = { type: "pan", pane: at?.pane.key, sx: x, sy: y, lx: x, ly: y, moved: false };
    }
  };

  const onMove = (e: ReactPointerEvent) => {
    const ed = editorRef.current;
    const g = gesture.current;
    if (ed && g) {
      const [x, y] = local(e);
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [x, y]);
      if (g.type === "pinch") {
        const [a, b] = [...pointers.current.values()];
        if (!a || !b) return;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.z0 * d) / Math.max(1, g.d0)));
        zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, target / ed.camera.zoom);
        const cx = (a[0] + b[0]) / 2;
        const cy = (a[1] + b[1]) / 2;
        ed.camera.x -= (cx - g.cx) / ed.camera.zoom;
        ed.camera.y -= (cy - g.cy) / ed.camera.zoom;
        g.cx = cx;
        g.cy = cy;
        return;
      }
      if (g.type === "node") {
        if (!g.moved && Math.hypot(x - g.sx, y - g.sy) < DRAG_PX) return;
        g.moved = true;
        const fr = frameFor(g.pane);
        const p = panesRef.current.find((q) => q.key === g.pane);
        if (!fr || !p) return;
        const [wx, wy] = p.scene.toWorld(fr, x, y);
        const nx = Math.round(wx + g.dx);
        const ny = Math.round(wy + g.dy);
        for (const sc of scenes()) sc.move(g.id, nx, ny);
        ed.onMove(g.id, nx, ny, false);
        if (wrap.current) wrap.current.style.cursor = "grabbing";
        return;
      }
      if (g.type === "pan") {
        if (!g.moved && Math.hypot(x - g.sx, y - g.sy) < DRAG_PX) return;
        g.moved = true;
        ed.camera.x -= (x - g.lx) / ed.camera.zoom;
        ed.camera.y -= (y - g.ly) / ed.camera.zoom;
        g.lx = x;
        g.ly = y;
        if (wrap.current) wrap.current.style.cursor = "grabbing";
        return;
      }
      if (g.type === "link") {
        const p = panesRef.current.find((q) => q.key === g.pane);
        const fr = frameFor(g.pane);
        if (!p || !fr) return;
        const over = p.scene.nodeAt(fr, x, y);
        const ok = over !== undefined && over !== g.from && ed.canLink(g.from, over);
        p.scene.draft = { from: g.from, x, y, ok };
        p.scene.hover = ok ? over : undefined;
        return;
      }
    }
    if (e.pointerType === "touch") return;
    const h = hit(e);
    for (const p of panesRef.current) p.scene.hover = h?.pane === p ? h.node : undefined;
    if (wrap.current) wrap.current.style.cursor = h && (onNodeClick || ed) ? (ed ? "grab" : "pointer") : "";
  };

  const onUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const ed = editorRef.current;
    const g = gesture.current;
    if (!ed || !g) return;
    if (g.type === "pinch") {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (wrap.current) wrap.current.style.cursor = "";
    const [x, y] = local(e);
    if (g.type === "node") {
      if (g.moved) {
        const n = panesRef.current[0]?.scene.nodes.get(g.id);
        if (n) ed.onMove(g.id, n.x, n.y, true);
      } else {
        ed.onSelect({ kind: "node", id: g.id });
        onNodeClick?.(g.pane, g.id);
      }
    } else if (g.type === "pan") {
      if (!g.moved) {
        const at = paneAt(x, y);
        const i = at?.pane.scene.linkAt(at.fr, x, y);
        const l = i !== undefined ? at?.pane.scene.links[i] : undefined;
        const id = l && ed.linkId(l[0], l[1]);
        ed.onSelect(id ? { kind: "link", id } : undefined);
      }
    } else if (g.type === "link") {
      endDraft();
      const p = panesRef.current.find((q) => q.key === g.pane);
      const fr = frameFor(g.pane);
      const over = p && fr ? p.scene.nodeAt(fr, x, y) : undefined;
      if (over && over !== g.from && ed.canLink(g.from, over)) ed.onLink(g.from, over);
      else if (Math.hypot(x - g.sx, y - g.sy) < DRAG_PX) ed.onSelect({ kind: "node", id: g.from });
    }
  };
  const onCancel = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    gesture.current = null;
    endDraft();
    if (g?.type === "node" && g.moved) {
      const n = panesRef.current[0]?.scene.nodes.get(g.id);
      if (n) editorRef.current?.onMove(g.id, n.x, n.y, true);
    }
  };

  const onLeave = () => {
    if (gesture.current) return;
    for (const p of panesRef.current) p.scene.hover = undefined;
  };
  const onClick = (e: ReactMouseEvent) => {
    if (editorRef.current) return;
    const h = hit(e);
    if (h) onNodeClick?.(h.pane.key, h.node);
  };

  // The selected node's link handle: drag it onto another node.
  const onHandleDown = (e: ReactPointerEvent) => {
    const ed = editorRef.current;
    const sel = ed?.selected;
    const p = panesRef.current[0];
    if (!ed || sel?.kind !== "node" || !p) return;
    e.stopPropagation();
    e.preventDefault();
    const [x, y] = local(e);
    pointers.current.set(e.pointerId, [x, y]);
    wrap.current?.setPointerCapture(e.pointerId);
    gesture.current = { type: "link", from: sel.id, pane: p.key, sx: x, sy: y };
    p.scene.draft = { from: sel.id, x, y, ok: false };
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
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onPointerLeave={onLeave}
      onClick={onClick}
      data-backend={backend}
      data-editor={editor ? "" : undefined}
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
      {editor && editor.selected?.kind === "node" && panes[0]?.scene.nodes.has(editor.selected.id) && (
        <button
          ref={handleEl}
          type="button"
          className="obs-link-handle"
          aria-label={editor.labels.connect(editor.selected.id)}
          title={editor.labels.connect(editor.selected.id)}
          onPointerDown={onHandleDown}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M3 13 13 3M7 3h6v6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {editor && (
        <div className="obs-zoom" style={{ left: `${area.x + area.w - 12}px`, top: `${area.y + 12}px` }}>
          <button
            type="button"
            className="obs-zoom-btn"
            aria-label={editor.labels.zoomIn}
            title={editor.labels.zoomIn}
            onClick={() => zoomCenter(1.25)}
          >
            +
          </button>
          <button
            type="button"
            className="obs-zoom-btn"
            aria-label={editor.labels.zoomOut}
            title={editor.labels.zoomOut}
            onClick={() => zoomCenter(0.8)}
          >
            −
          </button>
          <button
            type="button"
            className="obs-zoom-btn"
            aria-label={editor.labels.fit}
            title={`${editor.labels.fit} (F)`}
            onClick={() => {
              const p = panesRef.current[0];
              const fr = p && frameFor(p.key);
              if (p && fr) p.scene.fit(fr);
            }}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
      {editor && panes.every((p) => p.nodes.length === 0) && (
        <div
          className="obs-empty-stage"
          style={{ left: `${area.x + area.w / 2}px`, top: `${area.y + area.h / 2}px` }}
        >
          {editor.labels.empty}
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
