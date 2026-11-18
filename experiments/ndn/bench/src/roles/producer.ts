/**
 * Producer role (container `idem-bench-producer`, the namespace of `nfd-producer`). Overlay modes:
 * the HTTP producer endpoint on :8080 (`createProducerHandler`); in B0 the plain-call answers lose
 * their `_meta` (a plain MCP server, as the simulator's B0). Native modes: `serveNdn` on an NDNts
 * forwarder with a TCP face to the local NFD, prefix registered through `/localhost/nfd/rib`.
 *
 * Usage: `producer.ts <job.json>`. Writes `producer.ready`, waits for `stop`, writes `producer.json`.
 */
import { join } from "node:path";
import { type CallToolResult, stripEphemeral } from "@idem/core";
import { createProducerHandler } from "@idem/gateway";
import { serveNdn } from "@idem/ndn";
import { Forwarder } from "@ndn/fw";
import { enableNfdPrefixReg } from "@ndn/nfdmgmt";
import { TcpTransport } from "@ndn/node-transport";
import { MODES } from "../config";
import { HTTP_PORT, NDN_PORT } from "../topology";
import { benchProducer, producerKey, type ToolStats } from "../workload";
import { readJob, serveHttp, waitForFile, writeJson } from "./common";

const { job, cfg, work } = readJob();
const mode = MODES[job.mode];
const stats: ToolStats = { invocations: 0, perKey: new Map() };
const producer = await benchProducer(cfg, job.seed, stats);
const closers: (() => void)[] = [];

if (mode.binding === "overlay") {
  const handle = createProducerHandler(producer);
  const server = await serveHttp(HTTP_PORT, async (req) => {
    const res = await handle(req);
    if (!mode.plain || !new URL(req.url).pathname.endsWith("/idem/v1/call") || !res.ok) return res;
    const result = stripEphemeral((await res.json()) as CallToolResult);
    return Response.json(result, { status: res.status });
  });
  closers.push(() => server.close());
} else {
  const fw = Forwarder.create();
  const face = await TcpTransport.createFace({ fw }, "127.0.0.1", NDN_PORT);
  enableNfdPrefixReg(face);
  const served = await serveNdn({ producer, key: await producerKey(), fw, concurrency: 64 });
  closers.push(
    () => served.close(),
    () => face.close(),
  );
}

writeJson(join(work, "producer.ready"), { pid: process.pid });
await waitForFile(join(work, "stop"), 30 * 60_000);
const counts = [...stats.perKey.values()];
writeJson(join(work, "producer.json"), {
  invocations: stats.invocations,
  distinctArgs: stats.perKey.size,
  repeatedInvocations: counts.reduce((a, n) => a + (n - 1), 0),
});
for (const c of closers) c();
process.exit(0);
