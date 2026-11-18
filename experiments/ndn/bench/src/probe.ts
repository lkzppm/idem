/**
 * Reading the bench's counters: parsers for `/proc/net/dev`, `/proc/net/snmp`, `nfdc face list`
 * and `nfdc cs info` (pure, tested), and the `docker exec` calls that fetch them (host side).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** `docker <args>`; stdout. */
export async function docker(args: string[], timeoutMs = 60_000): Promise<string> {
  const { stdout } = await run("docker", args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export function dockerExec(container: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return docker(["exec", container, ...args], timeoutMs);
}

export interface IfCounters {
  rxBytes: number;
  rxPackets: number;
  txBytes: number;
  txPackets: number;
  rxDrop: number;
}

/** `/proc/net/dev` → counters per interface name. */
export function parseNetDev(text: string): Map<string, IfCounters> {
  const out = new Map<string, IfCounters>();
  for (const line of text.split("\n")) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const f = (m[2] as string).trim().split(/\s+/).map(Number);
    if (f.length < 16) continue;
    out.set(m[1] as string, {
      rxBytes: f[0] as number,
      rxPackets: f[1] as number,
      rxDrop: f[3] as number,
      txBytes: f[8] as number,
      txPackets: f[9] as number,
    });
  }
  return out;
}

/** `/proc/net/snmp` → `{ "Tcp.RetransSegs": n, "Udp.InDatagrams": n, … }`. */
export function parseSnmp(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const lines = text.split("\n").filter((l) => l.includes(":"));
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const [proto, keys] = (lines[i] as string).split(":") as [string, string];
    const [, values] = (lines[i + 1] as string).split(":") as [string, string];
    const ks = keys.trim().split(/\s+/);
    const vs = values.trim().split(/\s+/).map(Number);
    ks.forEach((k, j) => {
      out[`${proto}.${k}`] = vs[j] as number;
    });
  }
  return out;
}

/** `ip -o -4 addr show` → address → interface name. */
export function parseIpAddr(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)\//.exec(line);
    if (m) out.set(m[2] as string, (m[1] as string).split("@")[0] as string);
  }
  return out;
}

export interface NfdFace {
  id: number;
  remote: string;
  inI: number;
  inD: number;
  inN: number;
  outI: number;
  outD: number;
  outN: number;
}

/** `nfdc face list` → faces by id. */
export function parseFaces(text: string): Map<number, NfdFace> {
  const m = new Map<number, NfdFace>();
  for (const line of text.split("\n")) {
    const r =
      /faceid=(\d+) remote=(\S+) .*counters=\{in=\{(\d+)i (\d+)d (\d+)n \d+B\} out=\{(\d+)i (\d+)d (\d+)n \d+B\}\}/.exec(
        line,
      );
    if (!r) continue;
    const n = (i: number) => Number(r[i]);
    m.set(n(1), {
      id: n(1),
      remote: r[2] as string,
      inI: n(3),
      inD: n(4),
      inN: n(5),
      outI: n(6),
      outD: n(7),
      outN: n(8),
    });
  }
  return m;
}

/** `nfdc cs info` → entries, hits, misses. */
export function parseCsInfo(text: string): { entries: number; hits: number; misses: number } {
  const num = (k: string) => Number(new RegExp(`${k}=(\\d+)`).exec(text)?.[1] ?? Number.NaN);
  return { entries: num("nEntries"), hits: num("nHits"), misses: num("nMisses") };
}

/** The host part of an NFD face URI (`udp4://10.231.1.20:41000` → `10.231.1.20`). */
export function faceHost(remote: string): string | undefined {
  return /^(?:udp4|tcp4):\/\/([\d.]+):\d+$/.exec(remote)?.[1];
}
