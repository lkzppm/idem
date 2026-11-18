import { buildInterest, cacheablePolicy, keyPairFromSeed, Producer } from "@idem/core";
import { describe, expect, it } from "vitest";
import { Rng } from "./rng";
import {
  CITIES,
  distinctArgs,
  SEARCH_QUERIES,
  searchArgs,
  simTool,
  TOOL_CATALOG,
  TOOL_IDS,
  toolInfo,
  weatherArgs,
} from "./tools";

const ctx = { seed: 7, ttlMs: 1234, pageBytesMedian: 6144, maxResultBytes: 65536 };

async function producer(maxResultBytes = 65536) {
  return new Producer({
    producer: "tools.idem.dev",
    key: await keyPairFromSeed(new Uint8Array(32).fill(1)),
    tools: TOOL_IDS.map((t) => simTool(t, { ...ctx, ttlMs: toolInfo(t).ttlMs, maxResultBytes })),
  });
}

async function nameOf(p: Producer, tool: string, args: unknown): Promise<string> {
  const m = await p.manifest();
  const info = p.toolList().find((t) => t.name === tool);
  const c = info && (await cacheablePolicy(m, info));
  if (!c) throw new Error(`${tool} is not cacheable`);
  return (await buildInterest({ producer: p.producer, ...c, args: args as never, nonce: "n" })).interest.name;
}

describe("simulated tools", () => {
  it("declare in the manifest what TOOL_CATALOG says (mirror of the demo producer)", async () => {
    const m = await (await producer()).manifest();
    expect(m.tools.map((t) => t.tool)).toEqual([...TOOL_IDS]);
    for (const e of TOOL_CATALOG) {
      const pol = m.tools.find((t) => t.tool === e.tool);
      expect(pol?.cacheable, e.tool).toBe(e.cacheable);
      if (!e.cacheable) continue;
      expect(pol?.scope, e.tool).toBe(e.scope);
      expect(pol?.ttlMs, e.tool).toBe(e.ttlMs);
      expect(pol?.normalizers, e.tool).toEqual(e.normalizers);
    }
    expect(toolInfo("weather").ttlMs).toBe(15_000);
    expect(toolInfo("my_notes").scope).toBe("private");
  });

  it("give equivalent surface forms one name, and different arguments different names", async () => {
    const p = await producer();
    const r = new Rng(1);
    for (const q of SEARCH_QUERIES) {
      const canonical = await nameOf(p, "search_corpus", { query: q });
      for (let i = 0; i < 6; i++)
        expect(await nameOf(p, "search_corpus", searchArgs(q, r, 1))).toBe(canonical);
    }
    for (const c of CITIES) {
      const canonical = await nameOf(p, "weather", { city: c });
      for (let i = 0; i < 6; i++) expect(await nameOf(p, "weather", weatherArgs(c, r, 1))).toBe(canonical);
    }
    for (const t of ["fetch_page", "search_corpus", "weather"] as const) {
      const [x, y] = distinctArgs(t) ?? [];
      expect(await nameOf(p, t, x)).not.toBe(await nameOf(p, t, y));
    }
    expect(distinctArgs("my_notes")).toBeUndefined();
  });

  it("return deterministic, size-bounded results with no network", async () => {
    const p = await producer(200);
    const a = await p.handleCall("search_corpus", { query: "Named Data Networking " });
    const b = await p.handleCall("search_corpus", { query: "named data networking", limit: 3 });
    expect(a.content).toEqual(b.content);
    const text = (a.content[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(200);
    const w1 = await p.handleCall("weather", { city: "SÃO PAULO" });
    const w2 = await p.handleCall("weather", { city: "são paulo".normalize("NFD") });
    expect(w1.content).toEqual(w2.content);
    expect((w1.content[0] as { text: string }).text).toMatch(/^são paulo: \d+ °C, \w+ \(pseudo-data\)$/);
    const page = await p.handleCall("fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    expect((page.content[0] as { text: string }).text.length).toBeLessThanOrEqual(200);
    const notes = await p.handleCall("my_notes", {}, { auth: "token-x" });
    expect((notes.content[0] as { text: string }).text).toBe("notes of token-x");
  });
});
