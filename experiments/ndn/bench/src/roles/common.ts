/**
 * Shared plumbing of the roles that run inside the containers: the job file, the file-based
 * handshake with the orchestrator (ready / go / stop files in the run's work folder) and a
 * Node HTTP adapter for Web-standard handlers.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { type E4Config, type E4Mode, loadConfig } from "../config";

/** What the orchestrator hands a role, as `job.json` in the run's work folder. */
export interface Job {
  /** Config path, relative to the repository root. */
  config: string;
  mode: E4Mode;
  seed: number;
  lossPct: number;
  /** Work folder of the run, relative to the repository root. */
  work: string;
}

export const REPO = "/repo";

export function readJob(): { job: Job; cfg: E4Config; work: string } {
  const path = process.argv[2];
  if (!path) throw new Error("usage: <role>.ts <job.json>");
  const job = JSON.parse(readFileSync(path, "utf8")) as Job;
  return { job, cfg: loadConfig(join(REPO, job.config)), work: join(REPO, job.work) };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await sleep(25);
  }
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Serve a Web-standard handler on `0.0.0.0:port` with Node's HTTP/1.1 server (keep-alive). */
export async function serveHttp(port: number, handler: (r: Request) => Promise<Response>): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method ?? "GET",
        headers: req.headers as Record<string, string>,
        ...(body && req.method !== "GET" && { body }),
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "UPSTREAM_ERROR", message: String(e) }));
    }
  });
  server.keepAliveTimeout = 120_000;
  await new Promise<void>((r) => server.listen(port, "0.0.0.0", r));
  return server;
}

/** Order statistics of a list of numbers (for the stats files). */
export function quantiles(values: readonly number[]): { n: number; p50: number; p95: number; mean: number } {
  if (values.length === 0) return { n: 0, p50: Number.NaN, p95: Number.NaN, mean: Number.NaN };
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] as number;
  return { n: s.length, p50: at(0.5), p95: at(0.95), mean: s.reduce((a, b) => a + b, 0) / s.length };
}
