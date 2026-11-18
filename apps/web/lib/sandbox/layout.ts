/**
 * The observatory's layout model (ADR-029): which panels exist, which are open, and how tall the
 * bottom dock and how wide the sidebar are, as remembered in this browser. The panels live in a dock
 * along the bottom of the stage: a tab bar that is always there, and above it the open panels side
 * by side, in a drawer the visitor can make taller or shorter. The network gets the rest of the stage.
 */
import { clamp } from "./motion";

/**
 * What the stage runs (ADR-028): the Live example over real HTTP, or a network from the editor. Each
 * keeps its own set of open panels.
 */
export type SandboxMode = "live" | "net";

/** Every panel, in tab order (also the order of the 1–6 shortcuts). */
export const WINDOW_IDS = ["log", "tables", "inspector", "metrics", "compare", "safety"] as const;

/** A panel's id. */
export type WindowId = (typeof WINDOW_IDS)[number];

/** A rectangle on the stage (CSS px, from its top-left corner). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything the visitor can change about the workspace, as saved in `localStorage`. */
export interface Layout {
  v: 2;
  /** Open panels, per mode: each mode has its own set. */
  open: Record<SandboxMode, Partial<Record<WindowId, boolean>>>;
  /** Sidebar width (CSS px). */
  sidebar: number;
  /** Height of the dock's drawer, where the open panels sit (CSS px). */
  dock: number;
}

/** The band along the top of the stage the player bar keeps for itself. */
export const PLAYER_BAND = 62;
/** Height of the dock's tab bar, always at the bottom of the stage. */
export const TABBAR_H = 46;
export const DOCK_DEFAULT = 290;
export const DOCK_MIN = 170;
/** The drawer never takes the stage down to less than this for the network. */
export const NETWORK_MIN_H = 200;

export const SIDEBAR_DEFAULT = 304;
export const SIDEBAR_MIN = 264;
export const SIDEBAR_MAX = 420;
/** The stage never gets narrower than this when the sidebar widens. */
export const STAGE_MIN = 420;

const STORAGE_KEY = "idem.sandbox.layout.v1";

const DEFAULT_OPEN: Record<SandboxMode, Partial<Record<WindowId, boolean>>> = {
  live: { log: true, tables: true, inspector: true },
  net: { log: true, tables: true, compare: true },
};

/** A fresh layout: each mode's default panels open, the default sidebar and drawer sizes. */
export function defaultLayout(): Layout {
  return {
    v: 2,
    open: { live: { ...DEFAULT_OPEN.live }, net: { ...DEFAULT_OPEN.net } },
    sidebar: SIDEBAR_DEFAULT,
    dock: DOCK_DEFAULT,
  };
}

/** The drawer's height on a stage `stageH` tall: at least {@link DOCK_MIN}, leaving the network room. */
export function dockHeight(h: number, stageH: number): number {
  const max = Math.max(DOCK_MIN, stageH - TABBAR_H - NETWORK_MIN_H);
  return Math.round(clamp(h, DOCK_MIN, max));
}

/**
 * The part of a `W × H` stage left to the network: below the player bar's band, above the dock's
 * tab bar, and above its drawer when a panel is open (`drawer` is its height, 0 when closed; a phone
 * has no dock on the stage, so `tabbar` is 0 there).
 */
export function networkArea(W: number, H: number, drawer: number, tabbar = TABBAR_H): Rect {
  const h = Math.max(0, H - PLAYER_BAND - tabbar - drawer);
  return { x: 0, y: PLAYER_BAND, w: W, h };
}

const okId = (id: unknown): id is WindowId => (WINDOW_IDS as readonly unknown[]).includes(id);

/**
 * Read the saved layout; anything missing or malformed falls back to the defaults. A layout saved by
 * the floating windows (v1) keeps its open panels and sidebar width.
 */
export function loadLayout(): Layout {
  const base = defaultLayout();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Omit<Layout, "v">> & { v?: unknown };
    if (p.v !== 1 && p.v !== 2) return base;
    const open = { ...base.open };
    for (const m of ["live", "net"] as const) {
      // Layouts saved before the editor called the simulated set "swarm".
      const saved = p.open as Record<string, unknown> | undefined;
      const o = saved?.[m] ?? (m === "net" ? saved?.swarm : undefined);
      if (o && typeof o === "object") {
        open[m] = Object.fromEntries(
          Object.entries(o).filter(([id, v]) => okId(id) && typeof v === "boolean"),
        );
      }
    }
    return {
      v: 2,
      open,
      sidebar: Number.isFinite(p.sidebar)
        ? clamp(p.sidebar as number, SIDEBAR_MIN, SIDEBAR_MAX)
        : base.sidebar,
      dock: Number.isFinite(p.dock) ? Math.max(DOCK_MIN, Math.round(p.dock as number)) : base.dock,
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
