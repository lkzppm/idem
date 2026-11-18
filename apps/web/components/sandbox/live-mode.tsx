"use client";

import { argsDigestOf, type Data, type JsonValue, jcs, parseName, verifyData } from "@idem/core";
import { type CallOutcome, IdemClient } from "@idem/gateway";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { HTML_LANG } from "@/lib/i18n/locale";
import { sandbox } from "@/lib/i18n/messages/sandbox";
import { type PacketKind, type SceneNode, TopologyScene } from "@/lib/sandbox/scene";
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
import { isTyping, Slot, useWorkspace } from "./workspace";

const PRODUCER = "demo.idem.dev";
const HOP_MS = 300;
const MAX_AGENTS = 16;

type Tool = "fetch_page" | "search_corpus" | "weather" | "my_notes" | "send_email";
const TOOLS: Tool[] = ["fetch_page", "search_corpus", "weather", "my_notes", "send_email"];

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
  const [agents, setAgents] = useState(6);
  const [tool, setTool] = useState<Tool>("fetch_page");
  const [arg, setArg] = useState<Record<Tool, string>>({
    fetch_page: "3",
    search_corpus: "named data",
    weather: "Rio de Janeiro",
    my_notes: "",
    send_email: "team@example.com",
  });
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

  const clients = useMemo(() => {
    if (!origin) return [];
    return Array.from(
      { length: MAX_AGENTS },
      (_, i) =>
        new IdemClient({ edge: `${origin}/api/edge`, producer: PRODUCER, credential: `token-agent-${i}` }),
    );
  }, [origin]);

  // Topology: N agents → edge → producer.
  useEffect(() => {
    const ids = Array.from({ length: agents }, (_, i) => `agent-${i}`);
    scene.setTopology({
      nodes: [
        ...ids.map((id) => ({ id, kind: "agent" as const })),
        { id: "edge", kind: "forwarder" },
        { id: "producer", kind: "producer" },
      ],
      links: [...ids.map((a) => ({ a, b: "edge" })), { a: "edge", b: "producer" }],
    });
    setNodes([...scene.nodes.values()]);
  }, [agents, scene]);

  const connect = useCallback(async () => {
    const c = clients[0];
    if (!c) return;
    setStatus({ kind: "connecting" });
    try {
      const { tools } = await c.init();
      setStatus({ kind: "ready", tools: tools.map((x) => x.name) });
    } catch (e) {
      setStatus({ kind: "down", message: e instanceof Error ? e.message : "fetch failed" });
    }
  }, [clients]);

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

  const argsFor = useCallback(
    (which: Tool, agentIndex: number): unknown => {
      switch (which) {
        case "fetch_page":
          return { url: urlVariant(arg.fetch_page, agentIndex) };
        case "search_corpus":
          return { query: agentIndex % 2 ? `  ${arg.search_corpus.toUpperCase()} ` : arg.search_corpus };
        case "weather":
          return { city: arg.weather };
        case "my_notes":
          return {};
        case "send_email":
          return { to: arg.send_email, body: `hello from agent ${agentIndex}` };
      }
    },
    [arg],
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
    async (agentIndex: number, which: Tool, args: unknown, client = clients[agentIndex]): Promise<Row> => {
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
        done = { ...done, out };
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
    [clients, scene, animate, observe],
  );

  const ready = status.kind === "ready";

  const burst = useCallback(async () => {
    if (!ready) return;
    const results = await Promise.all(
      Array.from({ length: agents }, (_, i) => callOne(i, tool, argsFor(tool, i))),
    );
    setLastBurst(results.filter((r) => edgeEvents(r.out).some((e) => e.kind === "pit_aggregate")).length);
  }, [ready, agents, tool, argsFor, callOne]);

  const report = useCallback(
    (item: SafetyItem) => {
      setSafety((l) => [item, ...l].slice(0, 30));
      ws.reveal("safety");
    },
    [ws],
  );

  const tamper = useCallback(async () => {
    const evil = new IdemClient({
      edge: `${origin}/api/edge`,
      producer: PRODUCER,
      credential: "token-agent-0",
      intercept: (d: Data): Data => ({
        ...d,
        content: { content: [{ type: "text", text: "tampered on the last hop" }] },
      }),
    });
    const r = await callOne(0, "fetch_page", { url: urlVariant(arg.fetch_page, 0) }, evil);
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
  }, [origin, arg.fetch_page, callOne, report, tl]);

  const forge = useCallback(async () => {
    const c = clients[0];
    if (!c) return;
    const id = ++seq.current;
    const t0 = performance.now();
    scene.addPacket({ from: "agent-0", to: "edge", kind: "interest", t0, t1: t0 + HOP_MS, tampered: true });
    try {
      const I = await c.prepare("fetch_page", { url: urlVariant(arg.fetch_page, 0) });
      if (!I) throw new Error("fetch_page is not cacheable here");
      const r = await c.sendInterest({ ...I, args: { url: "https://evil.example/" } });
      animate("agent-0", undefined, t0 + HOP_MS, "idem", true);
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
  }, [clients, arg.fetch_page, scene, animate, report, tl]);

  const crossUser = useCallback(async () => {
    const a = await callOne(0, "my_notes", {});
    const b = await callOne(1, "my_notes", {});
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [burst]);

  const onNodeClick = (_pane: string, node: string) => {
    if (node.startsWith("agent-") && ready) {
      const i = Number(node.slice(6));
      void callOne(i, tool, argsFor(tool, i));
    } else if (node === "edge") {
      scene.selected = "edge";
      ws.reveal("tables");
    }
  };

  const select = (id: number) => {
    setSelected(id);
    ws.reveal("inspector");
  };

  const sel = rows.find((r) => r.id === selected) ?? rows[0];
  const statusText =
    status.kind === "ready"
      ? tl.status.ready
      : status.kind === "down"
        ? tl.status.down
        : tl.status.connecting;

  return (
    <>
      <Slot name="controls">
        <Section title={tl.scenario}>
          <fieldset className="obs-radio">
            <legend className="obs-legend-row">
              <Label tip={tl.tips.tool}>{tl.tool}</Label>
            </legend>
            {TOOLS.map((x) => (
              <label key={x} className="obs-radio-row" data-on={tool === x || undefined}>
                <input
                  type="radio"
                  name="live-tool"
                  value={x}
                  checked={tool === x}
                  onChange={() => setTool(x)}
                />
                <span className="t-mono">{x}</span>
              </label>
            ))}
          </fieldset>
          <p className="obs-note">{tl.toolNotes[tool]}</p>
          {tool !== "my_notes" && (
            <div className="obs-input-row">
              <Label htmlFor="live-arg" tip={tl.tips.arg}>
                {tl.argLabel[tool]}
              </Label>
              <input
                id="live-arg"
                value={arg[tool]}
                onChange={(e) => setArg((a) => ({ ...a, [tool]: e.target.value }))}
                spellCheck={false}
                className="obs-input t-mono"
              />
            </div>
          )}
          <Slider
            label={tl.agents}
            tip={tl.tips.agents}
            value={agents}
            min={1}
            max={MAX_AGENTS}
            onChange={setAgents}
          />
          <p className="obs-note">
            {tool === "fetch_page" ? `${tl.burstNote} ${tl.clickHint}` : tl.clickHint}
          </p>
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
        <p className="obs-footnote">{tl.instanceNote}</p>
      </Slot>

      <Slot name="stage">
        <StageCanvas
          panes={[
            {
              key: "live",
              scene,
              now: () => performance.now(),
              nodes,
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
          nodeAction={(_pane, n) =>
            n.kind === "agent" && ready ? tl.nodeAsk(n.id) : n.id === "edge" ? tl.nodeTables(n.id) : undefined
          }
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
        <PlayerAction primary disabled={!ready} kbd="Space" onClick={() => void burst()}>
          <PlayIcon />
          {tl.burst(agents)}
        </PlayerAction>
        <PlayerAction disabled={!ready} onClick={() => void callOne(0, tool, argsFor(tool, 0))}>
          {tl.callOne}
        </PlayerAction>
        <PlayerSep />
        <span className="obs-status" data-state={status.kind}>
          <span className="obs-status-dot" aria-hidden="true" />
          {statusText}
          <span className="t-mono text-faint">/api/edge</span>
        </span>
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
