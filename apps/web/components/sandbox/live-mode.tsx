"use client";

import { argsDigestOf, type Data, type JsonValue, jcs, parseName, verifyData } from "@idem/core";
import { type CallOutcome, IdemClient } from "@idem/gateway";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { HTML_LANG } from "@/lib/i18n/locale";
import { sandbox } from "@/lib/i18n/messages/sandbox";
import { WINDOW_IDS } from "@/lib/sandbox/layout";
import { type PacketKind, type SceneNode, TopologyScene } from "@/lib/sandbox/scene";
import { AsideCard } from "./aside-card";
import { NodeGlyph } from "./editor/glyph";
import { PlayIcon } from "./icons";
import { NdnPacket } from "./ndn-packet";
import { DataFacts, DigestCheck, NameParts, type SafetyItem, SafetyList, useContentCheck } from "./panels";
import { PlayerAction, PlayerSep } from "./player";
import { StageCanvas } from "./stage-canvas";
import {
  Button,
  Empty,
  Field,
  fixed,
  fmtBytes,
  fmtMs,
  Label,
  quantiles,
  Section,
  Slider,
  Stat,
  shortName,
} from "./ui";
import { isTyping, Slot, usePanels, useWorkspace } from "./workspace";

const PRODUCER = "demo.idem.dev";
const HOP_MS = 300;
const MAX_AGENTS = 16;

type Tool = "fetch_page" | "search_corpus" | "weather" | "my_notes" | "send_email";
const TOOLS: Tool[] = ["fetch_page", "search_corpus", "weather", "my_notes", "send_email"];

/** One agent in this browser: the tool it calls and the argument it passes. */
interface LiveAgent {
  /** Stable number: its node id (`agent-<n>`) and its credential (`token-agent-<n>`). */
  n: number;
  tool: Tool;
  arg: string;
}

/** The node that stands for every other visitor of the edge (ADR-030). */
const VISITORS = "visitors";
const POLL_MS = 3000;

/** The argument a new agent starts with for each tool. */
const DEFAULT_ARG: Record<Tool, string> = {
  fetch_page: "https://corpus.idem.dev/doc/3",
  search_corpus: "named data",
  weather: "Rio de Janeiro",
  my_notes: "",
  send_email: "team@example.com",
};

/** The call an agent makes. */
function argsOf(a: LiveAgent): unknown {
  switch (a.tool) {
    case "fetch_page":
      return { url: a.arg };
    case "search_corpus":
      return { query: a.arg };
    case "weather":
      return { city: a.arg };
    case "my_notes":
      return {};
    case "send_email":
      return { to: a.arg, body: `hello from agent ${a.n}` };
  }
}

/** A new agent: it fetches the shared page, spelling the URL its own way (one name for all). */
function newAgent(n: number): LiveAgent {
  return { n, tool: "fetch_page", arg: urlVariant("3", n) };
}

/** This tab's anonymous id at the edge (kept across reloads of the tab, never across tabs). */
function visitorId(): string {
  const make = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const k = "idem.sandbox.visitor";
    const v = window.sessionStorage.getItem(k) ?? make();
    window.sessionStorage.setItem(k, v);
    return v;
  } catch {
    return make();
  }
}

/** One call at the edge, as the edge's activity reports it (`/api/edge/activity`). */
export interface EdgeCall {
  seq: number;
  ago: number;
  mine: boolean;
  who: string;
  tool: string;
  digest?: string;
  outcome: "hit" | "aggregate" | "miss" | "bypass" | "error";
  filled?: "self" | "other";
  /** performance.now() when this page learned of it. */
  at: number;
}

/** Equivalent spellings of the same corpus URL; one per agent in a burst. */
function urlVariant(doc: string, i: number): string {
  const n = doc.replace(/\D/g, "") || "3";
  switch (i % 4) {
    case 0:
      return `https://corpus.idem.dev/doc/${n}`;
    case 1:
      return `https://CORPUS.idem.dev:443/doc/${n}`;
    case 2:
      return `https://corpus.idem.dev/doc/${n}#intro`;
    default:
      return `https://Corpus.IDEM.dev/doc/${n}#top`;
  }
}

/** One call this page made. */
interface Row {
  id: number;
  agent: number;
  tool: string;
  args: unknown;
  /** Name and canonical args, computed here before sending (cacheable tools only). */
  name?: string;
  canonical?: JsonValue;
  started: number;
  out?: CallOutcome;
  thrown?: string;
  /** Client used (the tamper attack uses its own). */
  client?: IdemClient;
  /** For an answer from the edge's cache or PIT: who first fetched that name (ADR-030). */
  filled?: "self" | "other";
}

/** An edge CS entry this page learned about from its traces. */
interface Seen {
  key: string;
  name: string;
  tool: string;
  scope: "public" | "private";
  agent: number;
  freshnessMs: number;
  /** Residual age when seen (ms) and when (performance.now()). */
  ageAtSeen: number;
  seenAt: number;
  bytes: number;
  hits: number;
}

type Status = { kind: "connecting" } | { kind: "ready"; tools: string[] } | { kind: "down"; message: string };
type Path = "cs" | "pit" | "producer" | "call";

function edgeEvents(out: CallOutcome | undefined) {
  return out?.trace.find((h) => h.node === "edge")?.events ?? out?.trace[0]?.events ?? [];
}

/** Which path answered a call (from the edge's trace). */
function pathOf(r: Row): Path | undefined {
  const out = r.out;
  if (!out || r.thrown) return undefined;
  if (out.via === "call") return "call";
  const kinds = new Set(edgeEvents(out).map((e) => e.kind));
  if (kinds.has("cs_hit")) return "cs";
  if (kinds.has("pit_aggregate")) return "pit";
  return "producer";
}

function resultText(out: CallOutcome | undefined): string {
  const c = out?.result?.content?.[0] as { text?: unknown } | undefined;
  return typeof c?.text === "string" ? c.text : out ? JSON.stringify(out.result).slice(0, 400) : "";
}

/**
 * Live mode (ADR-016): browser agents send real HTTP Interests to the deployed edge gateway, which
 * forwards to the deployed producer; every answer is verified here. The edge's traces are replayed on
 * the canvas; every number shown is counted from the calls this page made.
 */
export function LiveMode() {
  const t = useMessages(sandbox);
  const tl = t.live;
  const ws = useWorkspace();
  usePanels(WINDOW_IDS);
  const [agents, setAgents] = useState<LiveAgent[]>(() => Array.from({ length: 4 }, (_, i) => newAgent(i)));
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const nextN = useRef(4);
  const [picked, setPicked] = useState<string>();
  const [remote, setRemote] = useState<EdgeCall[]>([]);
  const [instances, setInstances] = useState<{ calls?: string; feed?: string }>({});
  const visitor = useRef("");
  const filled = useRef(new Map<string, "self" | "other" | "none">());
  const [status, setStatus] = useState<Status>({ kind: "connecting" });
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<number>();
  const [safety, setSafety] = useState<SafetyItem[]>([]);
  const [lastBurst, setLastBurst] = useState<number>();
  const [seen, setSeen] = useState<Map<string, Seen>>(new Map());
  const [nodes, setNodes] = useState<SceneNode[]>([]);
  const [tick, setTick] = useState(0);
  const scene = useMemo(() => new TopologyScene(), []);
  const seq = useRef(0);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  /**
   * Every request carries this tab's anonymous id, and the edge says back which instance answered
   * and, for a cache hit or a joined Interest, whether another visitor filled that name (ADR-030).
   */
  const liveFetch = useCallback<typeof fetch>(async (input, init) => {
    const headers = new Headers(init?.headers);
    if (visitor.current) headers.set("idem-visitor", visitor.current);
    const res = await fetch(input, { ...init, headers });
    const inst = res.headers.get("idem-edge-instance");
    if (inst) setInstances((x) => (x.calls === inst ? x : { ...x, calls: inst }));
    if (typeof init?.body === "string" && String(input).endsWith("/idem/v1/interest")) {
      try {
        const name = (JSON.parse(init.body) as { name?: unknown }).name;
        const f = res.headers.get("idem-filled-by");
        if (typeof name === "string") filled.current.set(name, f === "other" || f === "self" ? f : "none");
      } catch {
        // Not an Interest body.
      }
    }
    return res;
  }, []);

  // One client per agent number (its own credential), made when first needed.
  const clientMap = useRef(new Map<number, IdemClient>());
  const clientFor = useCallback(
    (n: number): IdemClient | undefined => {
      if (!origin) return undefined;
      let c = clientMap.current.get(n);
      if (!c) {
        c = new IdemClient({
          edge: `${origin}/api/edge`,
          producer: PRODUCER,
          credential: `token-agent-${n}`,
          fetch: liveFetch,
        });
        clientMap.current.set(n, c);
      }
      return c;
    },
    [origin, liveFetch],
  );

  // Topology: the agents and the other visitors → the deployed edge → the deployed producer.
  const agentKey = agents.map((a) => a.n).join();
  useEffect(() => {
    const ids = agentKey ? agentKey.split(",").map((n) => `agent-${n}`) : [];
    scene.setTopology({
      nodes: [
        { id: VISITORS, kind: "agent" as const },
        ...ids.map((id) => ({ id, kind: "agent" as const })),
        { id: "edge", kind: "forwarder" },
        { id: "producer", kind: "producer" },
      ],
      links: [
        { a: VISITORS, b: "edge" },
        ...ids.map((a) => ({ a, b: "edge" })),
        { a: "edge", b: "producer" },
      ],
    });
    setNodes([...scene.nodes.values()]);
  }, [agentKey, scene]);

  const connect = useCallback(async () => {
    const c = clientFor(0);
    if (!c) return;
    setStatus({ kind: "connecting" });
    try {
      const { tools } = await c.init();
      setStatus({ kind: "ready", tools: tools.map((x) => x.name) });
    } catch (e) {
      setStatus({ kind: "down", message: e instanceof Error ? e.message : "fetch failed" });
    }
  }, [clientFor]);

  useEffect(() => {
    void connect();
  }, [connect]);

  // Freshness bars count down: re-render the tables once a second while entries are fresh.
  useEffect(() => {
    if (seen.size === 0) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [seen.size]);

  const inFlight = rows.filter((r) => !r.out && !r.thrown);
  // Re-evaluated on each render; `tick` re-renders once a second while entries are fresh.
  void tick;
  const freshLeft = (s: Seen) => s.freshnessMs - (s.ageAtSeen + (performance.now() - s.seenAt));

  // The edge's fill on the canvas: blue while this page has a name pending, yellow by fresh entries.
  useEffect(() => {
    const pending = new Set(inFlight.map((r) => r.name ?? r.tool)).size;
    const entries = [...seen.values()];
    const fresh = entries.filter((s) => freshLeft(s) > 0).length;
    scene.setState("edge", { pit: pending, cs: fresh, fresh: entries.length ? fresh / entries.length : 0 });
  });

  /** Replay a returned trace on the canvas, starting at the edge. */
  const animate = useCallback(
    (agent: string, out: CallOutcome | undefined, from: number, kind: "idem" | "call", failed = false) => {
      let at = Math.max(performance.now(), from);
      const hop = (
        a: string,
        b: string,
        k: PacketKind,
        extra: { tampered?: boolean; label?: string } = {},
      ) => {
        scene.addPacket({ from: a, to: b, kind: k, t0: at, t1: at + HOP_MS, ...extra });
        at += HOP_MS;
      };
      const flashAt = (node: string, f: Parameters<TopologyScene["flash"]>[1]) => {
        const when = at;
        setTimeout(() => scene.flash(node, f), Math.max(0, when - performance.now()));
      };
      const label = out?.name;
      if (failed || !out || (out.error && !out.retried)) {
        flashAt("edge", "fail");
        hop("edge", agent, "nack");
        return;
      }
      const kinds = new Set(edgeEvents(out).map((e) => e.kind));
      const req: PacketKind = kind === "idem" ? "interest" : "call";
      const res: PacketKind = kind === "idem" ? "data" : "result";
      if (kinds.has("cs_hit")) {
        flashAt("edge", "cs");
        hop("edge", agent, res, { label });
      } else if (kinds.has("pit_aggregate")) {
        flashAt("edge", "pit");
        at += HOP_MS * 2;
        hop("edge", agent, res, { label });
      } else {
        hop("edge", "producer", req, { label });
        flashAt("producer", "produce");
        hop("producer", "edge", res, { label });
        hop("edge", agent, res, { label, tampered: out.retried });
      }
      if (out.retried) {
        flashAt(agent, "fail");
        hop(agent, "edge", "call");
        hop("edge", "producer", "call");
        hop("producer", "edge", "result");
        hop("edge", agent, "result");
      }
    },
    [scene],
  );

  /** Learn about the edge's CS from a returned trace. */
  const observe = useCallback((r: Row) => {
    const out = r.out;
    if (!out || out.via !== "idem" || !out.name || !out.data) return;
    const ev = edgeEvents(out);
    const insert = ev.find((e) => e.kind === "cs_insert") as { bytes?: number } | undefined;
    const hit = ev.find((e) => e.kind === "cs_hit") as { ageMs?: number } | undefined;
    if (!insert && !hit) return;
    const data = out.data;
    const key = data.meta.scope === "private" ? `${out.name}#${r.agent}` : out.name;
    setSeen((m) => {
      const next = new Map(m);
      const prev = next.get(key);
      const now = performance.now();
      if (insert) {
        next.set(key, {
          key,
          name: out.name as string,
          tool: r.tool,
          scope: data.meta.scope,
          agent: r.agent,
          freshnessMs: data.meta.freshnessMs,
          ageAtSeen: 0,
          seenAt: now,
          bytes: insert.bytes ?? prev?.bytes ?? 0,
          hits: prev?.hits ?? 0,
        });
      } else if (hit) {
        next.set(key, {
          key,
          name: out.name as string,
          tool: r.tool,
          scope: data.meta.scope,
          agent: r.agent,
          freshnessMs: data.meta.freshnessMs,
          ageAtSeen: hit.ageMs ?? 0,
          seenAt: now,
          bytes: prev?.bytes ?? 0,
          hits: (prev?.hits ?? 0) + 1,
        });
      }
      return next;
    });
  }, []);

  const callOne = useCallback(
    async (agentIndex: number, which: Tool, args: unknown, client = clientFor(agentIndex)): Promise<Row> => {
      const id = ++seq.current;
      const agent = `agent-${agentIndex}`;
      const started = performance.now();
      const kind = which === "send_email" ? "call" : "idem";
      scene.addPacket({
        from: agent,
        to: "edge",
        kind: kind === "idem" ? "interest" : "call",
        t0: started,
        t1: started + HOP_MS,
      });
      const row: Row = { id, agent: agentIndex, tool: which, args, started, ...(client && { client }) };
      setRows((rs) => [row, ...rs].slice(0, 80));
      let done: Row = row;
      try {
        if (!client) throw new Error("no client");
        if (kind === "idem") {
          const I = await client.prepare(which, args);
          if (I) {
            done = { ...done, name: I.name, canonical: I.args };
            setRows((rs) => rs.map((x) => (x.id === id ? { ...x, name: I.name, canonical: I.args } : x)));
          }
        }
        const out = await client.call(which, args);
        const f = out.name ? filled.current.get(out.name) : undefined;
        done = { ...done, out, ...(f && f !== "none" && { filled: f }) };
        if (f === "other") {
          const t = performance.now() + HOP_MS;
          setTimeout(() => scene.flash(VISITORS, "cs"), HOP_MS);
          void t;
        }
        animate(agent, out, started + HOP_MS, out.via === "idem" ? "idem" : "call");
        observe(done);
      } catch (e) {
        done = { ...done, thrown: e instanceof Error ? e.message : String(e) };
        animate(agent, undefined, started + HOP_MS, kind, true);
      }
      const final = done;
      setRows((rs) => rs.map((x) => (x.id === id ? final : x)));
      return final;
    },
    [clientFor, scene, animate, observe],
  );

  const ready = status.kind === "ready";

  const ask = useCallback((a: LiveAgent) => callOne(a.n, a.tool, argsOf(a)), [callOne]);

  const burst = useCallback(async () => {
    if (!ready) return;
    const results = await Promise.all(agentsRef.current.map((a) => ask(a)));
    setLastBurst(results.filter((r) => edgeEvents(r.out).some((e) => e.kind === "pit_aggregate")).length);
  }, [ready, ask]);

  const addAgent = useCallback(() => {
    if (agentsRef.current.length >= MAX_AGENTS) return;
    const a = newAgent(nextN.current++);
    setAgents((l) => [...l, a]);
    setPicked(`agent-${a.n}`);
  }, []);
  const setAgent = useCallback((n: number, patch: Partial<LiveAgent>) => {
    setAgents((l) => l.map((a) => (a.n === n ? { ...a, ...patch } : a)));
  }, []);
  const removeAgent = useCallback((n: number) => {
    setAgents((l) => l.filter((a) => a.n !== n));
    setPicked(undefined);
  }, []);

  // What the edge saw from every visitor: polled while the tab is visible (ADR-030). Others' calls
  // are replayed on the canvas from the visitors node; the first answer only fills the list.
  useEffect(() => {
    visitor.current = visitorId();
    if (!origin) return;
    let after = 0;
    let first = true;
    let stopped = false;
    const replay = (e: EdgeCall, delay: number) => {
      const go = (from: string, to: string, kind: PacketKind, at: number) =>
        scene.addPacket({ from, to, kind, t0: at, t1: at + HOP_MS });
      const t0 = performance.now() + delay;
      const req: PacketKind = e.outcome === "bypass" ? "call" : "interest";
      const res: PacketKind = e.outcome === "bypass" ? "result" : "data";
      go(VISITORS, "edge", req, t0);
      if (e.outcome === "miss" || e.outcome === "bypass") {
        go("edge", "producer", req, t0 + HOP_MS);
        go("producer", "edge", res, t0 + 2 * HOP_MS);
        go("edge", VISITORS, res, t0 + 3 * HOP_MS);
      } else if (e.outcome === "hit" || e.outcome === "aggregate") {
        setTimeout(() => scene.flash("edge", e.outcome === "hit" ? "cs" : "pit"), delay + HOP_MS);
        go("edge", VISITORS, res, t0 + HOP_MS);
      } else {
        go("edge", VISITORS, "nack", t0 + HOP_MS);
      }
    };
    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`${origin}/api/edge/activity?after=${after}`, {
          headers: { "idem-visitor": visitor.current },
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { instance: string; seq: number; entries: Omit<EdgeCall, "at">[] };
        if (stopped) return;
        // Another instance answered (or this one restarted): its sequence is its own.
        const now = performance.now();
        setInstances((x) => (x.feed === body.instance ? x : { ...x, feed: body.instance }));
        const fresh = body.entries.filter((e) => e.seq > after);
        after = body.seq;
        if (fresh.length === 0) return;
        const others = fresh.filter((e) => !e.mine);
        if (!first) others.slice(-8).forEach((e, i) => replay({ ...e, at: now }, i * 180));
        first = false;
        setRemote((l) => [...fresh.map((e) => ({ ...e, at: now - e.ago })).reverse(), ...l].slice(0, 60));
      } catch {
        // The feed is best effort: the calls themselves are unaffected.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [origin, scene]);

  const report = useCallback(
    (item: SafetyItem) => {
      setSafety((l) => [item, ...l].slice(0, 30));
      ws.reveal("safety");
    },
    [ws],
  );

  const tamper = useCallback(async () => {
    const first = agentsRef.current[0]?.n ?? 0;
    const evil = new IdemClient({
      edge: `${origin}/api/edge`,
      producer: PRODUCER,
      credential: `token-agent-${first}`,
      fetch: liveFetch,
      intercept: (d: Data): Data => ({
        ...d,
        content: { content: [{ type: "text", text: "tampered on the last hop" }] },
      }),
    });
    const r = await callOne(first, "fetch_page", { url: DEFAULT_ARG.fetch_page }, evil);
    const ok = r.out?.retried === true && r.out.verify?.ok === true;
    report({
      id: `live-${r.id}`,
      title: tl.attack.tamper,
      ok,
      detail: ok
        ? tl.attackResult.tamperOk
        : r.thrown
          ? tl.attackResult.failed(r.thrown)
          : tl.attackResult.unexpected(
              `retried=${String(r.out?.retried)}, verify=${String(r.out?.verify?.ok)}`,
            ),
    });
  }, [origin, liveFetch, callOne, report, tl]);

  const forge = useCallback(async () => {
    const first = agentsRef.current[0]?.n ?? 0;
    const c = clientFor(first);
    if (!c) return;
    const id = ++seq.current;
    const t0 = performance.now();
    const from = `agent-${first}`;
    scene.addPacket({ from, to: "edge", kind: "interest", t0, t1: t0 + HOP_MS, tampered: true });
    try {
      const I = await c.prepare("fetch_page", { url: DEFAULT_ARG.fetch_page });
      if (!I) throw new Error("fetch_page is not cacheable here");
      const r = await c.sendInterest({ ...I, args: { url: "https://evil.example/" } });
      animate(from, undefined, t0 + HOP_MS, "idem", true);
      const ok = r.error?.code === "DIGEST_MISMATCH";
      report({
        id: `live-${id}`,
        title: tl.attack.forge,
        ok,
        detail: ok
          ? tl.attackResult.forgeOk
          : tl.attackResult.unexpected(r.error?.code ?? (r.data ? "Data" : "—")),
      });
    } catch (e) {
      report({
        id: `live-${id}`,
        title: tl.attack.forge,
        ok: false,
        detail: tl.attackResult.failed(e instanceof Error ? e.message : String(e)),
      });
    }
  }, [clientFor, scene, animate, report, tl]);

  const crossUser = useCallback(async () => {
    const [x, y] = agentsRef.current;
    if (!x || !y) return;
    const a = await callOne(x.n, "my_notes", {});
    const b = await callOne(y.n, "my_notes", {});
    const ta = resultText(a.out);
    const tb = resultText(b.out);
    const ok = !a.thrown && !b.thrown && ta !== "" && ta !== tb;
    report({
      id: `live-${b.id}`,
      title: tl.attack.crossUser,
      ok,
      detail: ok
        ? tl.attackResult.crossOk(ta.slice(0, 60), tb.slice(0, 60))
        : a.thrown || b.thrown
          ? tl.attackResult.failed(a.thrown ?? b.thrown ?? "")
          : tl.attackResult.sameText,
    });
  }, [callOne, report, tl]);

  // Keys: Space bursts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void burst();
      } else if (e.key === "Escape") {
        setPicked(undefined);
      } else if ((e.key === "Delete" || e.key === "Backspace") && picked?.startsWith("agent-")) {
        e.preventDefault();
        removeAgent(Number(picked.slice(6)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [burst, picked, removeAgent]);

  // The picked node is drawn selected; an agent that is gone is unpicked.
  useEffect(() => {
    scene.selected = picked;
  }, [picked, scene]);

  const onNodeClick = (_pane: string, node: string) => {
    setPicked((p) => (p === node ? undefined : node));
    if (node === "edge") ws.reveal("tables");
  };

  const select = (id: number) => {
    setSelected(id);
    ws.reveal("inspector");
  };

  const sel = rows.find((r) => r.id === selected) ?? rows[0];
  // Other visitors seen at the edge in the last ten minutes (their labels).
  const others = new Set(remote.filter((e) => !e.mine).map((e) => e.who)).size;
  const statusText =
    status.kind === "ready"
      ? tl.status.ready
      : status.kind === "down"
        ? tl.status.down
        : tl.status.connecting;

  return (
    <>
      <Slot name="controls">
        <Section title={tl.add.title}>
          <div className="obs-palette">
            <button
              type="button"
              className="obs-chip-node"
              title={tl.add.tip}
              disabled={agents.length >= MAX_AGENTS}
              onClick={addAgent}
            >
              <NodeGlyph kind="agent" />
              {tl.add.agent}
            </button>
          </div>
          <p className="obs-note">{tl.add.hint(agents.length, MAX_AGENTS)}</p>
        </Section>
        <Section title={tl.attacks}>
          <div className="flex flex-col gap-2">
            <Button wide disabled={!ready} onClick={() => void tamper()}>
              {tl.attack.tamper}
            </Button>
            <Button wide disabled={!ready} onClick={() => void forge()}>
              {tl.attack.forge}
            </Button>
            <Button wide disabled={!ready} onClick={() => void crossUser()}>
              {tl.attack.crossUser}
            </Button>
          </div>
          <p className="obs-note">{tl.attackHint}</p>
        </Section>
      </Slot>

      <Slot name="aside">
        <AsideCard
          item={picked}
          keyOf={(id) => id}
          closeLabel={tl.card.close}
          onClose={() => setPicked(undefined)}
          face={(id) => {
            if (id.startsWith("agent-")) {
              const a = agents.find((x) => `agent-${x.n}` === id);
              if (!a) return null;
              return {
                glyph: <NodeGlyph kind="agent" size={16} />,
                title: id,
                sub: tl.card.agent,
                body: (
                  <AgentCard
                    a={a}
                    ready={ready}
                    labels={tl}
                    onChange={(patch) => setAgent(a.n, patch)}
                    onAsk={() => void ask(a)}
                    onRemove={() => removeAgent(a.n)}
                  />
                ),
              };
            }
            if (id === "edge" || id === VISITORS) {
              return {
                glyph: <NodeGlyph kind={id === "edge" ? "forwarder" : "agent"} size={16} />,
                title: id === "edge" ? "edge" : tl.card.visitorsTitle,
                sub: id === "edge" ? tl.card.edge : tl.card.visitors,
                body: <EdgeFeed calls={remote} instances={instances} labels={tl.feed} />,
              };
            }
            if (id === "producer") {
              return {
                glyph: <NodeGlyph kind="producer" size={16} />,
                title: PRODUCER,
                sub: tl.card.producer,
                body: <p className="obs-note">{tl.card.producerBody}</p>,
              };
            }
            return null;
          }}
        />
      </Slot>

      <Slot name="stage">
        <StageCanvas
          panes={[
            {
              key: "live",
              scene,
              now: () => performance.now(),
              nodes,
              boxes: {
                [VISITORS]: (
                  <>
                    <span className="obs-node-box-title">{tl.card.visitorsBox}</span>
                    <span className="obs-node-box-sub">· {others > 0 ? others : tl.card.visitorsNone}</span>
                  </>
                ),
              },
              badges: {
                edge:
                  seen.size > 0 || inFlight.length > 0 ? (
                    <span className="obs-badges">
                      {inFlight.length > 0 && (
                        <span className="text-interest">
                          PIT {new Set(inFlight.map((r) => r.name ?? r.tool)).size}
                        </span>
                      )}
                      {seen.size > 0 && (
                        <span className="text-data">
                          CS {[...seen.values()].filter((s) => freshLeft(s) > 0).length}
                        </span>
                      )}
                    </span>
                  ) : undefined,
              },
            },
          ]}
          area={ws.area}
          label={t.shell.canvas}
          onNodeClick={onNodeClick}
          nodeAction={(_pane, n) => tl.nodeOpen(n.id)}
        />
        {status.kind === "down" && (
          <div className="obs-stage-card" role="alert">
            <span className="t-mono text-[11px] text-faint">GET /api/edge/idem/v1/manifest/{PRODUCER}</span>
            <h3 className="t-h3">{tl.downTitle}</h3>
            <p className="text-[13px] text-muted">{tl.downBody(status.message)}</p>
            <Button variant="primary" onClick={() => void connect()}>
              {tl.retry}
            </Button>
          </div>
        )}
      </Slot>

      <Slot name="player">
        <PlayerAction
          primary
          disabled={!ready || agents.length === 0}
          kbd="Space"
          onClick={() => void burst()}
        >
          <PlayIcon />
          {tl.burst(agents.length)}
        </PlayerAction>
        <PlayerSep />
        <span className="obs-status" data-state={status.kind}>
          <span className="obs-status-dot" aria-hidden="true" />
          {statusText}
          <span className="t-mono text-faint">/api/edge</span>
        </span>
        {others > 0 && (
          <>
            <PlayerSep />
            <button type="button" className="obs-pothers" onClick={() => setPicked(VISITORS)}>
              {tl.feed.othersSeen(others)}
            </button>
          </>
        )}
      </Slot>

      <Slot name="hint:tables">edge</Slot>
      <Slot name="hint:inspector">{sel ? `a${sel.agent} · ${sel.tool}` : ""}</Slot>

      <Slot name="win:log">
        <LiveLog rows={rows} selected={sel?.id} onSelect={select} labels={tl} />
      </Slot>
      <Slot name="win:tables">
        <LiveTables
          rows={inFlight}
          seen={[...seen.values()]}
          freshLeft={freshLeft}
          lastBurst={lastBurst}
          labels={tl.tables}
        />
      </Slot>
      <Slot name="win:inspector">
        {sel ? <LiveInspector key={sel.id} row={sel} labels={tl} /> : <Empty>{tl.inspector.empty}</Empty>}
      </Slot>
      <Slot name="win:metrics">
        <LiveMetrics rows={rows} labels={tl.metrics} />
      </Slot>
      <Slot name="win:compare">
        <LiveCompare rows={rows} labels={tl.compare} />
      </Slot>
      <Slot name="win:safety">
        <SafetyList items={safety} labels={t.safety} />
      </Slot>
    </>
  );
}

type LiveStrings = (typeof sandbox)["en"]["live"];

/** An agent's card: the tool it calls and its argument, a call now, removal. */
function AgentCard({
  a,
  ready,
  labels,
  onChange,
  onAsk,
  onRemove,
}: {
  a: LiveAgent;
  ready: boolean;
  labels: LiveStrings;
  onChange: (patch: Partial<LiveAgent>) => void;
  onAsk: () => void;
  onRemove: () => void;
}) {
  const id = useId();
  return (
    <div className="obs-props">
      <fieldset className="obs-radio">
        <legend className="obs-legend-row">
          <Label tip={labels.tips.tool}>{labels.tool}</Label>
        </legend>
        {TOOLS.map((x) => (
          <label key={x} className="obs-radio-row" data-on={a.tool === x || undefined}>
            <input
              type="radio"
              name={`${id}-tool`}
              value={x}
              checked={a.tool === x}
              onChange={() =>
                onChange({ tool: x, arg: x === "fetch_page" ? urlVariant("3", a.n) : DEFAULT_ARG[x] })
              }
            />
            <span className="t-mono">{x}</span>
          </label>
        ))}
      </fieldset>
      <p className="obs-note">{labels.toolNotes[a.tool]}</p>
      {a.tool !== "my_notes" && (
        <div className="obs-input-row">
          <Label htmlFor={`${id}-arg`} tip={labels.tips.arg}>
            {labels.argLabel[a.tool]}
          </Label>
          <input
            id={`${id}-arg`}
            value={a.arg}
            onChange={(e) => onChange({ arg: e.target.value })}
            spellCheck={false}
            className="obs-input t-mono"
          />
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!ready} onClick={onAsk} className="flex-1">
          {labels.card.ask}
        </Button>
        <Button variant="ghost" onClick={onRemove} kbd="Del">
          {labels.card.remove}
        </Button>
      </div>
    </div>
  );
}

/**
 * What the deployed edge saw from every visitor (ADR-030): the tool, the args digest (public names
 * only) and how the edge answered, newest first; this tab's calls are marked "you". The list comes
 * from the instance that answered the poll, which may not be the one that answered this tab's calls.
 */
function EdgeFeed({
  calls,
  instances,
  labels,
}: {
  calls: EdgeCall[];
  instances: { calls?: string; feed?: string };
  labels: LiveStrings["feed"];
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = performance.now();
  const tone: Record<EdgeCall["outcome"], string> = {
    hit: "text-data",
    aggregate: "text-interest",
    miss: "text-muted",
    bypass: "text-muted",
    error: "text-fg",
  };
  return (
    <div className="obs-feed">
      <p className="obs-note">{labels.intro}</p>
      {calls.length === 0 ? (
        <p className="obs-empty-inline">{labels.empty}</p>
      ) : (
        <ul className="obs-feed-list">
          {calls.slice(0, 30).map((c) => (
            <li key={`${instances.feed}-${c.seq}`} data-mine={c.mine || undefined}>
              <span className="obs-feed-who">{c.mine ? labels.you : labels.visitor(c.who)}</span>
              <span className="t-mono text-fg">{c.tool}</span>
              {c.digest && <span className="t-mono text-faint">{c.digest}…</span>}
              <span className={tone[c.outcome]}>
                {labels.outcome[c.outcome]}
                {c.filled && ` · ${c.filled === "other" ? labels.filledOther : labels.filledSelf}`}
              </span>
              <span className="obs-feed-ago tabular-nums">{fmtAgo(now - c.at)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="obs-note">{labels.instance(instances.feed ?? "…")}</p>
      {instances.calls && instances.feed && instances.calls !== instances.feed && (
        <p className="obs-note obs-note-warn">{labels.otherInstance(instances.calls, instances.feed)}</p>
      )}
    </div>
  );
}

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}

function servedBy(r: Row, s: LiveStrings["served"]): { text: string; tone: string } {
  if (r.thrown) return { text: s.network, tone: "text-fg" };
  const out = r.out;
  if (!out) return { text: s.inFlight, tone: "text-faint" };
  if (out.error && !out.retried) return { text: out.error.code, tone: "text-fg" };
  if (out.via === "call") return { text: out.retried ? s.retry : s.plain, tone: "text-muted" };
  const p = pathOf(r);
  let text = s.producer;
  let tone = "text-muted";
  if (p === "cs") {
    const hit = edgeEvents(out).find((e) => e.kind === "cs_hit") as { ageMs?: number } | undefined;
    text = s.edgeCs(hit?.ageMs !== undefined ? `${fixed(hit.ageMs / 1000, 1)} s` : "?");
    tone = "text-data";
  } else if (p === "pit") {
    text = s.edgePit;
    tone = "text-interest";
  }
  if (out.retried) text += s.retried;
  if (r.filled === "other") text += s.byOther;
  return { text, tone };
}

function LiveLog({
  rows,
  selected,
  onSelect,
  labels,
}: {
  rows: Row[];
  selected: number | undefined;
  onSelect: (id: number) => void;
  labels: LiveStrings;
}) {
  const l = labels.log;
  if (rows.length === 0) return <Empty>{l.empty}</Empty>;
  return (
    <div className="obs-table-wrap">
      <table className="obs-table">
        <thead>
          <tr>
            <th>{l.agent}</th>
            <th>{l.tool}</th>
            <th>{l.servedBy}</th>
            <th className="text-right">{l.latency}</th>
            <th>{l.verify}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = servedBy(r, labels.served);
            return (
              <tr
                key={r.id}
                className="row-flash"
                data-selected={selected === r.id || undefined}
                tabIndex={0}
                onClick={() => onSelect(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(r.id);
                  }
                }}
              >
                <td className="text-muted">a{r.agent}</td>
                <td className="text-fg">{r.tool}</td>
                <td className={s.tone}>{s.text}</td>
                <td className="text-right text-muted tabular-nums">{r.out ? fmtMs(r.out.latencyMs) : "…"}</td>
                <td>
                  {r.out?.verify ? (
                    r.out.verify.ok ? (
                      <span className="text-data">✓ Ed25519</span>
                    ) : (
                      <span className="text-fg">✕ {r.out.verify.code}</span>
                    )
                  ) : (
                    <span className="text-faint">{r.out ? "—" : "…"}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="obs-win-foot">{l.count(rows.length)}</p>
    </div>
  );
}

function LiveTables({
  rows,
  seen,
  freshLeft,
  lastBurst,
  labels,
}: {
  rows: Row[];
  seen: Seen[];
  freshLeft: (s: Seen) => number;
  lastBurst: number | undefined;
  labels: LiveStrings["tables"];
}) {
  const groups = new Map<string, { name?: string; tool: string; agents: number[] }>();
  for (const r of rows) {
    const k = r.name ?? `call:${r.tool}`;
    const g = groups.get(k) ?? { ...(r.name !== undefined && { name: r.name }), tool: r.tool, agents: [] };
    g.agents.push(r.agent);
    groups.set(k, g);
  }
  const entries = [...seen].sort((a, b) => b.seenAt - a.seenAt);
  return (
    <div className="flex flex-col">
      <div className="obs-block">
        <h3 className="obs-block-title">{labels.pending}</h3>
        <p className="obs-note">{labels.pendingNote}</p>
        {groups.size === 0 ? (
          <p className="obs-empty-inline">{labels.noPending}</p>
        ) : (
          <table className="obs-table">
            <thead>
              <tr>
                <th>{labels.name}</th>
                <th className="text-right">{labels.waiting}</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.values()].map((g) => (
                <tr key={g.name ?? g.tool}>
                  <td className="text-interest">{g.name ? shortName(g.name) : g.tool}</td>
                  <td className="text-right tabular-nums">
                    <span className="obs-dots" aria-hidden="true">
                      {g.agents.slice(0, 12).map((a) => (
                        <span key={a} />
                      ))}
                    </span>{" "}
                    {g.agents.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {lastBurst !== undefined && <p className="obs-note text-interest">{labels.lastBurst(lastBurst)}</p>}
      </div>
      <div className="obs-block">
        <h3 className="obs-block-title">{labels.cache}</h3>
        <p className="obs-note">{labels.cacheNote}</p>
        {entries.length === 0 ? (
          <p className="obs-empty-inline">{labels.noCache}</p>
        ) : (
          <table className="obs-table">
            <thead>
              <tr>
                <th>{labels.name}</th>
                <th>{labels.scope}</th>
                <th>{labels.fresh}</th>
                <th className="text-right">{labels.hits}</th>
                <th className="text-right">{labels.size}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((s) => {
                const left = freshLeft(s);
                return (
                  <tr key={s.key} data-stale={left <= 0 || undefined}>
                    <td className="text-data">{shortName(s.name)}</td>
                    <td className={s.scope === "private" ? "text-interest" : "text-muted"}>
                      {s.scope === "private" ? `private · a${s.agent}` : s.scope}
                    </td>
                    <td>
                      <span className="obs-fresh">
                        <span className="obs-bar" aria-hidden="true" data-tone="data">
                          <span
                            style={{ transform: `scaleX(${Math.max(0, Math.min(1, left / s.freshnessMs))})` }}
                          />
                        </span>
                        <span className="tabular-nums">
                          {left > 0 ? `${Math.ceil(left / 1000)} s` : labels.expired}
                        </span>
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{s.hits}</td>
                    <td className="text-right text-muted tabular-nums">
                      {s.bytes ? fmtBytes(s.bytes) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LiveInspector({ row, labels }: { row: Row; labels: LiveStrings }) {
  const l = labels.inspector;
  const lang = HTML_LANG[useLocale()];
  const out = row.out;
  const data = out?.data;
  const contentOk = useContentCheck(data);
  const [argsOk, setArgsOk] = useState<boolean>();
  const [again, setAgain] = useState<{ ok: boolean; us: number } | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setArgsOk(undefined);
    setAgain(undefined);
    if (!row.name || row.canonical === undefined) return;
    let live = true;
    argsDigestOf(jcs(row.canonical))
      .then((d) => {
        if (live) setArgsOk(d === parseName(row.name as string).argsDigest);
      })
      .catch(() => {
        if (live) setArgsOk(false);
      });
    return () => {
      live = false;
    };
  }, [row.name, row.canonical]);

  const verifyAgain = async () => {
    if (!data || !row.client) return;
    setBusy(true);
    try {
      const t0 = performance.now();
      const r = await verifyData(data, row.client.trust);
      setAgain({ ok: r.ok, us: (performance.now() - t0) * 1000 });
    } catch {
      setAgain({ ok: false, us: 0 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="obs-inspector">
      <Field label={l.args}>
        <p className="t-mono break-all text-fg">{JSON.stringify(row.args)}</p>
      </Field>
      {row.tool === "send_email" ? (
        <p className="obs-note">{l.plain}</p>
      ) : (
        <>
          {row.canonical !== undefined && (
            <Field label={l.canonical}>
              <p className="t-mono break-all text-muted">{jcs(row.canonical)}</p>
            </Field>
          )}
          {row.name && (
            <Field label={l.name}>
              <NameParts name={row.name} labels={l.parts} />
              <DigestCheck label={l.argsCheck} ok={argsOk} yes={l.match} no={l.mismatch} />
            </Field>
          )}
          {data && (
            <>
              <DataFacts
                data={data}
                producedAt={new Date(data.meta.producedAt).toLocaleTimeString(lang)}
                labels={l}
              />
              <DigestCheck label={l.contentCheck} ok={contentOk} yes={l.match} no={l.mismatch} />
            </>
          )}
          {out?.verify && (
            <Field label={l.verified}>
              <div className="flex flex-wrap items-center gap-2">
                {out.verify.ok ? (
                  <span className="t-mono text-data">✓ Ed25519 · {out.verify.keyId.slice(0, 12)}…</span>
                ) : (
                  <span className="t-mono text-fg">
                    ✕ {out.verify.code} · {out.verify.reason}
                  </span>
                )}
                {data && row.client && (
                  <Button variant="ghost" disabled={busy} onClick={() => void verifyAgain()}>
                    {l.verifyAgain}
                  </Button>
                )}
              </div>
              {again && (
                <p className={`t-mono text-[11.5px] ${again.ok ? "text-data" : "text-fg"}`}>
                  {again.ok ? "✓" : "✕"} {l.verifiedIn(again.us.toFixed(0))}
                </p>
              )}
            </Field>
          )}
        </>
      )}
      <Field label={l.trace}>
        {(out?.trace ?? []).length === 0 ? (
          <p className="text-faint">{out ? l.noTrace : l.pending}</p>
        ) : (
          <ol className="obs-trace">
            {(out?.trace ?? []).map((h, i) => (
              <li key={i}>
                <span className="text-fg">{h.node}</span>
                <span className="text-faint"> · </span>
                <span className="text-muted">{h.events.map((e) => e.kind).join(" → ")}</span>
              </li>
            ))}
          </ol>
        )}
      </Field>
      {/* The same call as a native NDN Interest and Data (ADR-026), built and checked here with NDNts. */}
      {row.name && <NdnPacket name={row.name} args={row.canonical} data={data} trust={row.client?.trust} />}
      <Field label={l.result}>
        <p className="obs-result">
          {row.thrown ? labels.attackResult.failed(row.thrown) : resultText(out) || l.pending}
        </p>
      </Field>
    </div>
  );
}

function LiveMetrics({ rows, labels }: { rows: Row[]; labels: LiveStrings["metrics"] }) {
  const done = rows.filter((r) => r.out || r.thrown);
  const by = (p: Path) => done.filter((r) => pathOf(r) === p).length;
  const cs = by("cs");
  const pit = by("pit");
  const producer = by("producer") + by("call") + done.filter((r) => r.out?.retried).length;
  const plain = by("call");
  const verified = done.filter((r) => r.out?.verify?.ok).length;
  const caught = done.filter((r) => r.out?.retried).length;
  const q = quantiles(done.flatMap((r) => (r.out ? [r.out.latencyMs] : [])));
  const total = Math.max(1, done.length);
  const saved = cs + pit;
  return (
    <div className="flex flex-col">
      <div className="obs-stats">
        <Stat label={labels.calls} value={done.length} hint={labels.inFlight(rows.length - done.length)} />
        <Stat label={labels.upstream} value={producer} tone="interest" bar={producer / total} />
        <Stat label={labels.cs} value={cs} tone="data" bar={cs / total} />
        <Stat label={labels.pit} value={pit} tone="interest" bar={pit / total} />
        <Stat label={labels.plain} value={plain} />
        <Stat label={labels.verified} value={verified} tone="data" />
        <Stat label={labels.caught} value={caught} />
        <Stat label={labels.p50} value={fmtMs(q.p50)} />
        <Stat label={labels.p95} value={fmtMs(q.p95)} />
      </div>
      {done.length > 0 && <p className="obs-win-foot text-fg">{labels.saved(saved, done.length)}</p>}
      <p className="obs-win-foot">{labels.note}</p>
    </div>
  );
}

function LiveCompare({ rows, labels }: { rows: Row[]; labels: LiveStrings["compare"] }) {
  const paths: Path[] = ["cs", "pit", "producer", "call"];
  const stats = paths.map((p) => {
    const xs = rows.filter((r) => pathOf(r) === p && r.out).map((r) => (r.out as CallOutcome).latencyMs);
    return { p, n: xs.length, ...quantiles(xs) };
  });
  const max = Math.max(1, ...stats.map((s) => (Number.isFinite(s.p95) ? s.p95 : 0)));
  if (stats.every((s) => s.n === 0)) return <Empty>{labels.empty}</Empty>;
  return (
    <div className="flex flex-col">
      <div className="obs-compare">
        {stats.map((s) => (
          <div key={s.p} className="obs-compare-row" data-path={s.p}>
            <span className="obs-compare-name">{labels.paths[s.p]}</span>
            <span className="obs-compare-n t-mono">
              {s.n} {labels.calls}
            </span>
            <span className="obs-compare-bar" aria-hidden="true">
              <span
                className="p95"
                style={{ transform: `scaleX(${Number.isFinite(s.p95) ? s.p95 / max : 0})` }}
              />
              <span
                className="p50"
                style={{ transform: `scaleX(${Number.isFinite(s.p50) ? s.p50 / max : 0})` }}
              />
            </span>
            <span className="obs-compare-val t-mono">
              {labels.p50} {fmtMs(s.p50)} · {labels.p95} {fmtMs(s.p95)}
            </span>
          </div>
        ))}
      </div>
      <p className="obs-win-foot">{labels.note}</p>
    </div>
  );
}
