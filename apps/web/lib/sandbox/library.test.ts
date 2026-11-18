import { afterEach, describe, expect, it } from "vitest";
import { example } from "./examples";
import {
  deleteNetwork,
  exportFile,
  fileName,
  getNetwork,
  LIBRARY_KEY,
  listNetworks,
  MAX_FILE_CHARS,
  MAX_NAME,
  MAX_NETWORKS,
  parseImport,
  renameNetwork,
  saveNetwork,
} from "./library";
import type { Network } from "./network";

function fakeStorage(seed: Record<string, string> = {}, failWrites = false) {
  const data = new Map(Object.entries(seed));
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failWrites) throw new Error("QuotaExceededError");
        data.set(k, v);
      },
      removeItem: (k: string) => void data.delete(k),
    },
  };
  return data;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const swarm = () => example("swarm") as Network;
let seq = 0;
const ids = () => `id-${++seq}`;

describe("the library", () => {
  it("is empty without storage, and survives storage that throws", () => {
    expect(listNetworks()).toEqual([]);
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
    };
    expect(listNetworks()).toEqual([]);
    expect(saveNetwork({ name: "x", net: swarm() })).toEqual({ ok: false, error: "storage" });
    expect(deleteNetwork("nope")).toBe(false);
  });

  it("creates an entry, lists it, and updates it in place", () => {
    fakeStorage();
    const a = saveNetwork({ name: "  My   swarm ", net: swarm() }, 1000, ids);
    expect(a.ok && a.entry.name).toBe("My swarm");
    if (!a.ok) return;
    const b = saveNetwork({ name: "Other", net: swarm() }, 2000, ids);
    expect(listNetworks().map((e) => e.name)).toEqual(["Other", "My swarm"]);
    const upd = saveNetwork({ id: a.entry.id, net: { ...swarm(), from: "edited" } }, 3000, ids);
    expect(upd.ok && upd.entry.id).toBe(a.entry.id);
    const all = listNetworks();
    expect(all.map((e) => e.name)).toEqual(["My swarm", "Other"]);
    expect(all[0]?.savedAt).toBe(3000);
    expect(getNetwork(a.entry.id)?.net.from).toBe("edited");
    expect(b.ok).toBe(true);
  });

  it("renames, deletes, and keeps the name between 1 and MAX_NAME characters", () => {
    fakeStorage();
    const r = saveNetwork({ name: "a", net: swarm() }, 1, ids);
    if (!r.ok) throw new Error("save");
    expect(renameNetwork(r.entry.id, "x".repeat(200))).toBe(true);
    expect(getNetwork(r.entry.id)?.name).toHaveLength(MAX_NAME);
    expect(renameNetwork(r.entry.id, "   ")).toBe(true);
    expect(getNetwork(r.entry.id)?.name).toHaveLength(MAX_NAME);
    expect(renameNetwork("missing", "z")).toBe(false);
    expect(deleteNetwork(r.entry.id)).toBe(true);
    expect(deleteNetwork(r.entry.id)).toBe(false);
    expect(listNetworks()).toEqual([]);
  });

  it("refuses a new entry past the cap, but still updates an existing one", () => {
    fakeStorage();
    let first = "";
    for (let i = 0; i < MAX_NETWORKS; i++) {
      const r = saveNetwork({ name: `n${i}`, net: swarm() }, i, ids);
      if (r.ok && i === 0) first = r.entry.id;
    }
    expect(saveNetwork({ name: "one more", net: swarm() })).toEqual({ ok: false, error: "full" });
    expect(saveNetwork({ id: first, net: swarm() }).ok).toBe(true);
    expect(listNetworks()).toHaveLength(MAX_NETWORKS);
  });

  it("refuses a network that is too large, and reports a failed write", () => {
    fakeStorage();
    const big = { ...swarm(), from: "x".repeat(300_000) };
    expect(saveNetwork({ name: "big", net: big })).toEqual({ ok: false, error: "too-big" });
    fakeStorage({}, true);
    expect(saveNetwork({ name: "q", net: swarm() })).toEqual({ ok: false, error: "storage" });
  });

  it("drops garbage in storage: bad JSON, bad items, duplicate ids, networks that do not validate", () => {
    fakeStorage({ [LIBRARY_KEY]: "{not json" });
    expect(listNetworks()).toEqual([]);
    const good = { id: "a", name: "Good", savedAt: 5, net: swarm() };
    fakeStorage({
      [LIBRARY_KEY]: JSON.stringify({
        v: 1,
        items: [
          good,
          good,
          null,
          7,
          { id: "b", name: "Bad", net: { nodes: "no" } },
          { name: "no id", net: swarm() },
        ],
      }),
    });
    expect(listNetworks().map((e) => e.id)).toEqual(["a"]);
  });
});

describe("files", () => {
  it("round-trips an export through an import", () => {
    const net = swarm();
    const f = exportFile("My Swarm: v2", net, 42);
    expect(f.filename).toBe("my-swarm-v2.idem.json");
    const back = parseImport(f.text, "Fallback");
    expect(back).toEqual({ ok: true, name: "My Swarm: v2", net });
  });

  it("accepts a bare network, naming it with the fallback", () => {
    const r = parseImport(JSON.stringify(swarm()), "From file");
    expect(r.ok && r.name).toBe("From file");
  });

  it("rejects text that is not JSON, JSON that is not a network, and a file that is too large", () => {
    expect(parseImport("hello", "x")).toEqual({ ok: false, error: "not-json" });
    expect(parseImport("", "x")).toEqual({ ok: false, error: "not-json" });
    expect(parseImport("42", "x")).toEqual({ ok: false, error: "not-network" });
    expect(parseImport("null", "x")).toEqual({ ok: false, error: "not-network" });
    expect(parseImport('{"format":"idem-network","network":{"nodes":1}}', "x")).toEqual({
      ok: false,
      error: "not-network",
    });
    expect(parseImport(`"${"a".repeat(MAX_FILE_CHARS)}"`, "x")).toEqual({ ok: false, error: "too-big" });
  });

  it("repairs what it reads like any untrusted network (a dangling link is dropped)", () => {
    const net = swarm();
    const dirty = {
      ...net,
      links: [...net.links, { id: "zz", a: "ghost", b: net.nodes[0]?.id ?? "", latencyMs: 1, lossPct: 0 }],
    };
    const r = parseImport(JSON.stringify(dirty), "x");
    expect(r.ok && r.net.links.some((l) => l.id === "zz")).toBe(false);
  });

  it("makes a safe file name", () => {
    expect(fileName("../../etc/passwd")).toBe("etc-passwd.idem.json");
    expect(fileName("Rede açaí")).toBe("rede-acai.idem.json");
    expect(fileName("***")).toBe("network.idem.json");
  });
});
