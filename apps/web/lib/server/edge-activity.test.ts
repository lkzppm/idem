import { HEADERS, PATHS } from "@idem/gateway";
import { describe, expect, it } from "vitest";
import { EdgeActivity, FILLED_HEADER, INSTANCE_HEADER, VISITOR_HEADER } from "./edge-activity";

const NAME = `/idem/v1/demo.idem.dev/fetch_page/${"s".repeat(22)}/${"a".repeat(43)}`;

/** A stand-in edge: answers with the trace and scope it is told to. */
function edge(kind: string, scope = "public") {
  return async (_req: Request) =>
    new Response(JSON.stringify({ name: NAME, meta: { scope } }), {
      headers: { [HEADERS.trace]: JSON.stringify([{ node: "edge", events: [{ kind, t: 0 }] }]) },
    });
}

function interest(visitor: string, name = NAME) {
  return new Request(`https://x.test/api/edge${PATHS.interest}`, {
    method: "POST",
    headers: { [VISITOR_HEADER]: visitor, "content-type": "application/json" },
    body: JSON.stringify({ name, args: { url: "secret-ish" } }),
  });
}

describe("the edge's activity", () => {
  it("says a hit was filled by another visitor, and never records the arguments", async () => {
    const a = new EdgeActivity({ instance: "i1", now: () => 1000 });
    await a.record(interest("visitor-aaaaaaaa"), edge("upstream_out"));
    const res = await a.record(interest("visitor-bbbbbbbb"), edge("cs_hit"));
    expect(res.headers.get(FILLED_HEADER)).toBe("other");
    expect(res.headers.get(INSTANCE_HEADER)).toBe("i1");
    const again = await a.record(interest("visitor-aaaaaaaa"), edge("cs_hit"));
    expect(again.headers.get(FILLED_HEADER)).toBe("self");

    const v = a.view("visitor-bbbbbbbb");
    expect(v.entries.map((e) => [e.mine, e.outcome, e.filled])).toEqual([
      [false, "miss", undefined],
      [true, "hit", "other"],
      [false, "hit", "self"],
    ]);
    expect(v.entries[0]?.digest).toBe("aaaaaaaa");
    expect(JSON.stringify(v)).not.toContain("secret-ish");
    expect(JSON.stringify(v)).not.toContain("visitor-aaaaaaaa");
    // One visitor gets one label.
    expect(v.entries[0]?.who).toBe(v.entries[2]?.who);
    expect(v.entries[0]?.who).not.toBe(v.entries[1]?.who);
  });

  it("credits the first asker when a call joins its pending Interest", async () => {
    const a = new EdgeActivity({ now: () => 0 });
    let release: () => void = () => {};
    const slow = (_req: Request) =>
      new Promise<Response>((r) => {
        release = () => void edge("upstream_out")(_req).then(r);
      });
    const first = a.record(interest("visitor-aaaaaaaa"), slow);
    const joined = await a.record(interest("visitor-bbbbbbbb"), edge("pit_aggregate"));
    release();
    await first;
    expect(joined.headers.get(FILLED_HEADER)).toBe("other");
  });

  it("lists private answers without a digest and without crediting anyone", async () => {
    const a = new EdgeActivity({ now: () => 0 });
    await a.record(interest("visitor-aaaaaaaa"), edge("upstream_out", "private"));
    const res = await a.record(interest("visitor-bbbbbbbb"), edge("cs_hit", "private"));
    expect(res.headers.get(FILLED_HEADER)).toBeNull();
    expect(a.view(undefined).entries.every((e) => e.digest === undefined && e.filled === undefined)).toBe(
      true,
    );
  });

  it("returns only entries after a sequence number, and forgets old ones", async () => {
    let now = 0;
    const a = new EdgeActivity({ now: () => now });
    await a.record(interest("visitor-aaaaaaaa"), edge("upstream_out"));
    await a.record(interest("visitor-aaaaaaaa"), edge("cs_hit"));
    expect(a.view(undefined, 1).entries.map((e) => e.seq)).toEqual([2]);
    now = 11 * 60_000;
    expect(a.view(undefined).entries).toEqual([]);
  });
});
