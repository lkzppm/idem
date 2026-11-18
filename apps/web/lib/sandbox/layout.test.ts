import { afterEach, describe, expect, it } from "vitest";
import {
  DOCK_MIN,
  defaultLayout,
  dockHeight,
  loadLayout,
  NETWORK_MIN_H,
  networkArea,
  PLAYER_BAND,
  SIDEBAR_MAX,
  saveLayout,
  splitPanes,
  TABBAR_H,
} from "./layout";

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

describe("the dock", () => {
  it("leaves the network the stage between the player's band and the tab bar, and the drawer when open", () => {
    const top = PLAYER_BAND;
    expect(networkArea(1000, 800, 0)).toEqual({ x: 0, y: top, w: 1000, h: 800 - top - TABBAR_H });
    expect(networkArea(1000, 800, 300)).toEqual({ x: 0, y: top, w: 1000, h: 800 - top - TABBAR_H - 300 });
    // A phone: no dock on the stage.
    expect(networkArea(390, 400, 0, 0)).toEqual({ x: 0, y: top, w: 390, h: 400 - top });
  });

  it("keeps the drawer between its minimum and what leaves the network room", () => {
    expect(dockHeight(10, 800)).toBe(DOCK_MIN);
    expect(dockHeight(5000, 800)).toBe(800 - TABBAR_H - NETWORK_MIN_H);
    expect(dockHeight(250, 800)).toBe(250);
    // A stage too short for both: the drawer keeps its minimum.
    expect(dockHeight(250, 300)).toBe(DOCK_MIN);
  });
});

describe("layout persistence", () => {
  it("round-trips a saved layout", () => {
    fakeStorage();
    const l = defaultLayout();
    l.open.net.metrics = true;
    l.sidebar = 333;
    l.dock = 321;
    saveLayout(l);
    expect(loadLayout()).toEqual(l);
  });

  it("falls back to the defaults on garbage, an unknown version or missing storage", () => {
    fakeStorage({ "idem.sandbox.layout.v1": "{not json" });
    expect(loadLayout()).toEqual(defaultLayout());
    fakeStorage({ "idem.sandbox.layout.v1": JSON.stringify({ v: 3 }) });
    expect(loadLayout()).toEqual(defaultLayout());
    delete (globalThis as { window?: unknown }).window;
    expect(loadLayout()).toEqual(defaultLayout());
    expect(() => saveLayout(defaultLayout())).not.toThrow();
  });

  it("keeps the open panels and the sidebar of a floating-window layout (v1), and drops bad values", () => {
    fakeStorage({
      "idem.sandbox.layout.v1": JSON.stringify({
        v: 1,
        rects: { tables: { x: 1, y: 2, w: 300, h: 200 } },
        open: { live: { log: true, nope: true, tables: "yes" } },
        collapsed: { inspector: true },
        order: ["log"],
        sidebar: 9999,
      }),
    });
    const l = loadLayout();
    expect(l).toEqual({
      v: 2,
      open: { live: { log: true }, net: defaultLayout().open.net },
      sidebar: SIDEBAR_MAX,
      dock: defaultLayout().dock,
    });
  });

  it("reads the old swarm panel set as the editor's", () => {
    fakeStorage({
      "idem.sandbox.layout.v1": JSON.stringify({ v: 1, open: { swarm: { metrics: true, log: false } } }),
    });
    expect(loadLayout().open.net).toEqual({ metrics: true, log: false });
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
