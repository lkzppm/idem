/**
 * HTTP forwarder role (sidecars of edge1, edge2, regional): `createGateway` from `@idem/gateway`
 * on :8080 with an 8 MiB LRU Content Store, counting the engine's events.
 *
 * Usage: `gateway.ts <job.json> <node> <upstream-url> <producer|forwarder>`. Writes
 * `gateway-<node>.ready`, waits for `stop`, writes `gateway-<node>.json`.
 */
import { join } from "node:path";
import { MemoryContentStore } from "@idem/core";
import { createGateway } from "@idem/gateway";
import { HTTP_PORT, PRODUCER_NAME } from "../topology";
import { quantiles, readJob, serveHttp, waitForFile, writeJson } from "./common";

const { cfg, work } = readJob();
const [node, url, kind] = process.argv.slice(3) as [string, string, "producer" | "forwarder"];
if (!node || !url || (kind !== "producer" && kind !== "forwarder")) {
  throw new Error("usage: gateway.ts <job.json> <node> <upstream-url> <producer|forwarder>");
}

const events: Record<string, number> = {};
const verifyUs: number[] = [];
const gateway = createGateway({
  id: node,
  upstreams: [{ producer: PRODUCER_NAME, url, kind }],
  cs: new MemoryContentStore({ maxBytes: cfg.overlay.csMaxBytes, policy: "lru" }),
  onEvent: (e) => {
    events[e.kind] = (events[e.kind] ?? 0) + 1;
    if (e.kind === "verify_ok") verifyUs.push(e.us);
  },
});
const server = await serveHttp(HTTP_PORT, gateway.handle);

writeJson(join(work, `gateway-${node}.ready`), { pid: process.pid });
// The handshake (manifest, tool list) happens before `go`; count only the workload.
await waitForFile(join(work, "go"), 30 * 60_000);
const before = { ...events };
verifyUs.length = 0;
await waitForFile(join(work, "stop"), 30 * 60_000);
const delta: Record<string, number> = {};
for (const [k, v] of Object.entries(events)) delta[k] = v - (before[k] ?? 0);
writeJson(join(work, `gateway-${node}.json`), { node, events: delta, verifyUs: quantiles(verifyUs) });
server.close();
process.exit(0);
