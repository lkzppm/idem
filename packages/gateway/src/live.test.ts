// Opt-in end-to-end test against a running deployment (local `next dev` or a Vercel preview):
//   IDEM_LIVE_URL=http://localhost:3000 pnpm vitest run --project gateway live
// Skipped by default: tests never depend on the network (CLAUDE.md rule 7).
import { describe, expect, it } from "vitest";
import { IdemClient } from "./client";

const base = process.env.IDEM_LIVE_URL;
const edge = `${base}/api/edge`;
const producer = process.env.IDEM_PRODUCER ?? "demo.idem.dev";

describe.skipIf(!base)("live deployment", () => {
  it("aggregates a concurrent burst, then serves from the edge CS, all verified", async () => {
    const doc = `https://corpus.idem.dev/doc/${Math.floor(Math.random() * 12)}?run=${Date.now()}`;
    const agents = Array.from(
      { length: 5 },
      (_, i) => new IdemClient({ edge, producer, credential: `live-agent-${i}` }),
    );
    await Promise.all(agents.map((a) => a.init()));
    const burst = await Promise.all(agents.map((a) => a.call("fetch_page", { url: doc })));
    for (const o of burst) expect(o.verify?.ok, JSON.stringify(o.error)).toBe(true);
    const kinds = burst.map((o) => o.trace[0]?.events.map((e) => e.kind) ?? []);
    expect(kinds.filter((k) => k.includes("upstream_out"))).toHaveLength(1);
    expect(kinds.filter((k) => k.includes("pit_aggregate"))).toHaveLength(4);

    const again = await agents[0]?.call("fetch_page", {
      url: doc.replace("corpus.idem.dev", "CORPUS.idem.dev:443"),
    });
    expect(again?.trace[0]?.events.map((e) => e.kind)).toContain("cs_hit");
    expect(again?.verify?.ok).toBe(true);
    console.log(
      "burst latencies (ms):",
      burst.map((o) => Math.round(o.latencyMs)),
      "hit latency (ms):",
      Math.round(again?.latencyMs ?? 0),
    );
  });

  it("keeps private results per user and passes side effects through", async () => {
    const alice = new IdemClient({ edge, producer, credential: "alice" });
    const bob = new IdemClient({ edge, producer, credential: "bob" });
    const [a, b] = await Promise.all([alice.call("my_notes", {}), bob.call("my_notes", {})]);
    expect(JSON.stringify(a.result)).toContain("Notes for alice");
    expect(JSON.stringify(b.result)).toContain("Notes for bob");
    const mail = await alice.call("send_email", { to: "team@example.com", body: "hi" });
    expect(mail.via).toBe("call");
  });
});
