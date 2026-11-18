import { afterEach, describe, expect, it } from "vitest";
import {
  clampRect,
  defaultLayout,
  defaultRect,
  freeRect,
  GUTTER,
  HUD_BOTTOM,
  loadLayout,
  MIN_W,
  type Rect,
  SIDEBAR_MAX,
  saveLayout,
  splitPanes,
  WINDOW_IDS,
} from "./layout";

const inside = (r: Rect, W: number, H: number) =>
  r.x >= GUTTER && r.y >= GUTTER && r.x + r.w <= W - GUTTER && r.y + r.h <= H - GUTTER;

function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  };
  return data;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("default arrangement", () => {
  for (const [W, H] of [
    [1136, 835],
    [980, 600],
    [1600, 1100],
  ] as const) {
    it(`keeps every window inside a ${W}×${H} stage`, () => {
      for (const id of WINDOW_IDS) expect(inside(defaultRect(id, W, H), W, H)).toBe(true);
    });
  }

  it("stacks the right column without overlap and keeps the log above the HUD", () => {
    const W = 1136;
    const H = 835;
    const top = defaultRect("metrics", W, H);
    const mid = defaultRect("tables", W, H);
    const bottom = defaultRect("inspector", W, H);
    expect(top.y + top.h).toBeLessThanOrEqual(mid.y);
    expect(mid.y + mid.h).toBeLessThanOrEqual(bottom.y);
    const log = defaultRect("log", W, H);
    expect(log.y + log.h).toBeLessThanOrEqual(H - HUD_BOTTOM);
    expect(log.x + log.w).toBeLessThanOrEqual(top.x);
  });
});

describe("clampRect", () => {
  it("pulls a window dragged off the stage back inside", () => {
    const r = clampRect({ x: -400, y: 5000, w: 300, h: 200 }, 1000, 700);
    expect(inside(r, 1000, 700)).toBe(true);
  });

  it("shrinks a window larger than the stage", () => {
    const r = clampRect({ x: 0, y: 0, w: 3000, h: 3000 }, 800, 500);
    expect(r.w).toBe(800 - 2 * GUTTER);
    expect(r.h).toBe(500 - 2 * GUTTER);
    expect(inside(r, 800, 500)).toBe(true);
  });

  it("never goes below the minimum width on a tiny stage", () => {
    expect(clampRect({ x: 0, y: 0, w: 500, h: 200 }, 200, 300).w).toBe(MIN_W);
  });
});

describe("layout persistence", () => {
  it("round-trips a saved layout", () => {
    fakeStorage();
    const l = defaultLayout();
    l.rects.log = { x: 40, y: 50, w: 400, h: 220 };
    l.open.swarm.metrics = true;
    l.collapsed.tables = true;
    l.order = ["safety", "log", "tables", "inspector", "metrics", "compare"];
    l.sidebar = 333;
    saveLayout(l);
    expect(loadLayout()).toEqual(l);
  });

  it("falls back to the defaults on garbage, a wrong version or missing storage", () => {
    fakeStorage({ "idem.sandbox.layout.v1": "{not json" });
    expect(loadLayout()).toEqual(defaultLayout());
    fakeStorage({ "idem.sandbox.layout.v1": JSON.stringify({ v: 2 }) });
    expect(loadLayout()).toEqual(defaultLayout());
    delete (globalThis as { window?: unknown }).window;
    expect(loadLayout()).toEqual(defaultLayout());
    expect(() => saveLayout(defaultLayout())).not.toThrow();
  });

  it("drops unknown windows and bad values, clamps the sidebar and completes the order", () => {
    fakeStorage({
      "idem.sandbox.layout.v1": JSON.stringify({
        v: 1,
        rects: {
          log: { x: 1, y: 2, w: 300, h: "x" },
          nope: { x: 0, y: 0, w: 1, h: 1 },
          tables: { x: 1, y: 2, w: 300, h: 200 },
        },
        open: { live: { log: true, nope: true, tables: "yes" } },
        collapsed: { inspector: true, nope: true },
        order: ["log", "nope", "log"],
        sidebar: 9999,
      }),
    });
    const l = loadLayout();
    expect(Object.keys(l.rects)).toEqual(["tables"]);
    expect(l.open.live).toEqual({ log: true });
    expect(l.open.swarm).toEqual(defaultLayout().open.swarm);
    expect(l.collapsed).toEqual({ inspector: true });
    expect([...l.order].sort()).toEqual([...WINDOW_IDS].sort());
    expect(l.sidebar).toBe(SIDEBAR_MAX);
  });
});

describe("freeRect", () => {
  it("is the whole stage with no windows", () => {
    expect(freeRect(1000, 800, [])).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });

  it("leaves the top-left to the network with the default column and log", () => {
    const W = 1136;
    const H = 835;
    const rects = (["metrics", "tables", "inspector", "log"] as const).map((id) => defaultRect(id, W, H));
    const f = freeRect(W, H, rects);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    expect(f.x + f.w).toBeLessThanOrEqual(defaultRect("metrics", W, H).x);
    expect(f.y + f.h).toBeLessThanOrEqual(defaultRect("log", W, H).y);
  });

  it("ignores a window floating in the middle", () => {
    expect(freeRect(1000, 800, [{ x: 400, y: 300, w: 200, h: 150 }])).toEqual({
      x: 0,
      y: 0,
      w: 1000,
      h: 800,
    });
  });

  it("gives up on bands that would leave too little room", () => {
    const f = freeRect(1000, 800, [
      { x: 12, y: 12, w: 900, h: 300 },
      { x: 12, y: 400, w: 900, h: 380 },
    ]);
    expect(f).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
});

describe("splitPanes", () => {
  it("covers the area exactly", () => {
    const area = { x: 10, y: 20, w: 900, h: 500 };
    for (const n of [1, 2, 3]) {
      const ps = splitPanes(area, n);
      expect(ps).toHaveLength(n);
      expect(ps.reduce((s, p) => s + p.w * p.h, 0)).toBeCloseTo(area.w * area.h);
    }
  });

  it("uses columns in a wide area and rows in a tall one", () => {
    const wide = splitPanes({ x: 0, y: 0, w: 1400, h: 500 }, 2);
    expect(wide[1]?.x).toBeGreaterThan(0);
    const tall = splitPanes({ x: 0, y: 0, w: 500, h: 1400 }, 2);
    expect(tall[1]?.y).toBeGreaterThan(0);
  });
});
