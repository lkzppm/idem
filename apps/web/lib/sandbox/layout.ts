/**
 * The observatory's layout model: which windows exist, where they sit by default, how the layout is
 * remembered, and which part of the stage the windows leave free for the network.
 *
 * Positions are CSS pixels relative to the stage's top-left corner. A window the visitor never moved
 * has no stored rectangle and follows the default arrangement as the stage resizes; a moved one keeps
 * its rectangle, clamped back inside the stage.
 */
import { clamp } from "./motion";

/**
 * What the stage runs (ADR-028): the Live example over real HTTP, or a network from the editor. Each
 * keeps its own set of open windows.
 */
export type SandboxMode = "live" | "net";

/** Every window, in sidebar order (also the order of the 1–6 shortcuts). */
export const WINDOW_IDS = ["log", "tables", "inspector", "metrics", "compare", "safety"] as const;

/** A window's id. */
export type WindowId = (typeof WINDOW_IDS)[number];

/** A window's rectangle on the stage (CSS px). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything the visitor can change about the workspace, as saved in `localStorage`. */
export interface Layout {
  v: 1;
  /** Rectangles of windows the visitor moved or resized; the rest follow the defaults. */
  rects: Partial<Record<WindowId, Rect>>;
  /** Open windows, per mode: each mode has its own set. */
  open: Record<SandboxMode, Partial<Record<WindowId, boolean>>>;
  collapsed: Partial<Record<WindowId, boolean>>;
  /** Back to front. */
  order: WindowId[];
  /** Sidebar width (CSS px). */
  sidebar: number;
}

/** Gap between windows and the stage edges. */
export const GUTTER = 12;
/** Height of a collapsed window (its title bar). */
export const TITLE_H = 38;
/** Room kept free along the stage bottom for the legend and the help button. */
export const HUD_BOTTOM = 52;

export const SIDEBAR_DEFAULT = 304;
export const SIDEBAR_MIN = 264;
export const SIDEBAR_MAX = 420;
/** The stage never gets narrower than this when the sidebar widens. */
export const STAGE_MIN = 420;

/** Smallest size a window may be resized to. */
export const MIN_W = 260;
export const MIN_H = 140;

const STORAGE_KEY = "idem.sandbox.layout.v1";

const DEFAULT_OPEN: Record<SandboxMode, Partial<Record<WindowId, boolean>>> = {
  live: { log: true, tables: true, inspector: true, metrics: true },
  net: { log: true, tables: true, compare: true },
};

/** A fresh layout: nothing moved, each mode's default windows open. */
export function defaultLayout(): Layout {
  return {
    v: 1,
    rects: {},
    open: { live: { ...DEFAULT_OPEN.live }, net: { ...DEFAULT_OPEN.net } },
    collapsed: {},
    order: [...WINDOW_IDS],
    sidebar: SIDEBAR_DEFAULT,
  };
}

/** Width of the right-hand column of default windows. */
function columnWidth(W: number): number {
  return Math.round(clamp(W * 0.32, 300, 384));
}

/**
 * The default arrangement for a stage of `W × H`: a column on the right (metrics or compare on top,
 * then the PIT/CS tables, then the inspector) and the event log along the bottom, so the network
 * keeps the top-left of the stage. The safety window opens over the network, top left, because it
 * only appears when an attack runs.
 */
export function defaultRect(id: WindowId, W: number, H: number): Rect {
  const g = GUTTER;
  const cw = columnWidth(W);
  const cx = W - g - cw;
  const avail = Math.max(3 * MIN_H, H - 4 * g);
  const top = Math.round(avail * 0.3);
  const mid = Math.round(avail * 0.34);
  const bottom = avail - top - mid;
  switch (id) {
    case "metrics":
    case "compare":
      return { x: cx, y: g, w: cw, h: top };
    case "tables":
      return { x: cx, y: 2 * g + top, w: cw, h: mid };
    case "inspector":
      return { x: cx, y: 3 * g + top + mid, w: cw, h: bottom };
    case "log": {
      const w = Math.round(clamp(cx - 2 * g, MIN_W, 640));
      const h = Math.round(clamp(H * 0.3, MIN_H + 20, 260));
      return { x: g, y: Math.max(g, H - HUD_BOTTOM - h), w, h };
    }
    case "safety":
      return {
        x: g,
        y: g + 44,
        w: Math.min(360, Math.max(MIN_W, cx - 2 * g)),
        h: Math.round(clamp(H * 0.34, MIN_H, 280)),
      };
  }
}

/** A rectangle kept inside a `W × H` stage (shrunk first if it is larger than the stage). */
export function clampRect(r: Rect, W: number, H: number): Rect {
  const w = Math.min(r.w, Math.max(MIN_W, W - 2 * GUTTER));
  const h = Math.min(r.h, Math.max(TITLE_H, H - 2 * GUTTER));
  return {
    w,
    h,
    x: Math.round(clamp(r.x, GUTTER, W - GUTTER - w)),
    y: Math.round(clamp(r.y, GUTTER, H - GUTTER - h)),
  };
}

/** Read the saved layout; anything missing or malformed falls back to the defaults. */
export function loadLayout(): Layout {
  const base = defaultLayout();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Layout>;
    if (p.v !== 1) return base;
    const ok = (id: unknown): id is WindowId => (WINDOW_IDS as readonly unknown[]).includes(id);
    const rects: Layout["rects"] = {};
    for (const [id, r] of Object.entries(p.rects ?? {})) {
      if (ok(id) && r && [r.x, r.y, r.w, r.h].every((n) => Number.isFinite(n))) rects[id] = r;
    }
    const open = { ...base.open };
    for (const m of ["live", "net"] as const) {
      // Layouts saved before the editor called the simulated set "swarm".
      const saved = p.open as Record<string, unknown> | undefined;
      const o = saved?.[m] ?? (m === "net" ? saved?.swarm : undefined);
      if (o && typeof o === "object") {
        open[m] = Object.fromEntries(Object.entries(o).filter(([id, v]) => ok(id) && typeof v === "boolean"));
      }
    }
    const order = (p.order ?? []).filter(ok);
    for (const id of WINDOW_IDS) if (!order.includes(id)) order.unshift(id);
    return {
      v: 1,
      rects,
      open,
      collapsed: Object.fromEntries(
        Object.entries(p.collapsed ?? {}).filter(([id, v]) => ok(id) && typeof v === "boolean"),
      ),
      order: [...new Set(order)],
      sidebar: Number.isFinite(p.sidebar)
        ? clamp(p.sidebar as number, SIDEBAR_MIN, SIDEBAR_MAX)
        : base.sidebar,
    };
  } catch {
    return base;
  }
}

/** Save the layout. Storage can be missing or full (private windows): the layout then lasts the visit. */
export function saveLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // No storage: the layout lasts for this visit.
  }
}

/** Forget the saved layout. */
export function clearLayout(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget.
  }
}

/**
 * The part of the stage the open windows leave to the network. Each window that hugs an edge of the
 * stage claims a band along that edge (a window in a corner joins the side that adds the least area,
 * so a column whose top window touches the top still reads as one column);
 * windows floating in the middle claim nothing. If the bands would leave too little room, the network
 * takes the whole stage and the windows float over it.
 */
export function freeRect(W: number, H: number, rects: readonly Rect[]): Rect {
  const near = 36;
  const band = { l: 0, r: 0, t: 0, b: 0 };
  type Side = keyof typeof band;
  const sides = (r: Rect) => {
    const out: { side: Side; size: number }[] = [];
    if (r.x <= near) out.push({ side: "l", size: r.x + r.w + GUTTER });
    if (r.x + r.w >= W - near) out.push({ side: "r", size: W - r.x + GUTTER });
    if (r.y <= near) out.push({ side: "t", size: r.y + r.h + GUTTER });
    if (r.y + r.h >= H - near - HUD_BOTTOM) out.push({ side: "b", size: H - r.y + GUTTER });
    return out;
  };
  // Area a band of `size` on `side` would add beyond what that side already claims.
  const added = (side: Side, size: number) =>
    Math.max(0, size - band[side]) * (side === "l" || side === "r" ? H : W);
  const claim = (r: Rect) => {
    const best = sides(r).sort((a, b) => added(a.side, a.size) - added(b.side, b.size))[0];
    if (best) band[best.side] = Math.max(band[best.side], best.size);
  };
  // Windows on one edge first; corner windows then join whichever side costs least given those.
  const many = rects.filter((r) => sides(r).length > 1);
  for (const r of rects) if (sides(r).length === 1) claim(r);
  for (const r of many) claim(r);
  const w = W - band.l - band.r;
  const h = H - band.t - band.b;
  if (w < Math.max(280, W * 0.34) || h < Math.max(200, H * 0.3)) return { x: 0, y: 0, w: W, h: H };
  return { x: band.l, y: band.t, w, h };
}

/**
 * Split `area` into `n` panes for the side-by-side comparison: columns or rows, whichever gives
 * panes closest to the network's natural shape (a little wider than tall).
 */
export function splitPanes(area: Rect, n: number): Rect[] {
  if (n <= 1) return [area];
  const ideal = 1.25;
  const colAspect = area.w / n / area.h;
  const rowAspect = area.w / (area.h / n);
  const cols = Math.abs(Math.log(colAspect / ideal)) <= Math.abs(Math.log(rowAspect / ideal));
  return Array.from({ length: n }, (_, i) =>
    cols
      ? { x: area.x + (area.w / n) * i, y: area.y, w: area.w / n, h: area.h }
      : { x: area.x, y: area.y + (area.h / n) * i, w: area.w, h: area.h / n },
  );
}
