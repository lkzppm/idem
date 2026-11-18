"use client";

import type { ForwarderEventKind } from "@idem/core";
import type { AttackRecord, Metrics, SimMode } from "@idem/sim";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useMessages } from "@/lib/i18n/client";
import { editor } from "@/lib/i18n/messages/editor";
import { sandbox } from "@/lib/i18n/messages/sandbox";
import { splitPanes } from "@/lib/sandbox/layout";
import {
  addLink,
  addNode,
  attachTo,
  autoToolsAll,
  type Issue,
  issues,
  linkBetween,
  linkProblem,
  moveNode,
  type NetNodeKind,
  type Network,
  placeNear,
  producerNodes,
  removeLink,
  removeNode,
} from "@/lib/sandbox/network";
import {
  type CompareMode,
  type LoggedEvent,
  type NameSnapshot,
  NetworkRun,
  runSignature,
  type TableSnapshot,
  totalCalls,
} from "@/lib/sandbox/run";
import type { Camera, SceneNode } from "@/lib/sandbox/scene";
import { NodeGlyph } from "./editor/glyph";
import { SelectionCard } from "./editor/selection-card";
import type { NetworkState } from "./editor/use-network";
import { PauseIcon, PlayIcon, RestartIcon } from "./icons";
import { NdnEngine } from "./ndn-engine";
import { DataFacts, DigestCheck, NameParts, type SafetyItem, SafetyList, useContentCheck } from "./panels";
import { PlayerButton, PlayerIssues, PlayerProgress, PlayerSep, SpeedMenu } from "./player";
import { type EditorSelection, StageCanvas, type StageEditor, type StageEditorHandle } from "./stage-canvas";
import {
  Button,
  Check,
  Empty,
  Field,
  fixed,
  fmtBytes,
  fmtMs,
  fmtPct,
  InfoTip,
  Label,
  Section,
  Segmented,
  Stat,
  shortName,
} from "./ui";
import { useDragToStage } from "./window/drag-to-stage";
import { isTyping, Slot, useWorkspace } from "./workspace";

type Strings = (typeof sandbox)["en"];
type SwarmStrings = Strings["swarm"];
type EditorStrings = (typeof editor)["en"];

interface RunView {
  mode: SimMode;
  metrics?: Metrics;
  tables: Record<string, { pit: number; cs: number; fresh: number }>;
  counts?: Record<ForwarderEventKind, number>;
  done: boolean;
  now: number;
  error?: string;
  nodes: SceneNode[];
}

const LOG_KINDS: ForwarderEventKind[] = [
  "interest_in",
  "cs_hit",
  "pit_aggregate",
  "upstream_out",
  "data_in",
  "verify_ok",
  "verify_fail",
  "cs_insert",
  "cs_evict",
  "pit_satisfy",
  "pit_expire",
  "drop",
  "bypass",
];

function kindTone(k: ForwarderEventKind): string {
  if (k === "cs_hit" || k === "cs_insert" || k === "data_in" || k === "pit_satisfy") return "text-data";
  if (k === "interest_in" || k === "pit_aggregate" || k === "upstream_out") return "text-interest";
  if (k === "verify_fail" || k === "drop") return "text-fg";
  return "text-muted";
}

function detail(e: LoggedEvent["e"], d: SwarmStrings["log"]["detail"]): string {
  switch (e.kind) {
    case "cs_hit":
      return d.age(Math.round(e.ageMs));
    case "pit_aggregate":
      return d.waiting(e.waiting);
    case "pit_satisfy":
      return d.faces(e.faces);
    case "verify_ok":
    case "verify_fail":
      return `${Math.round(e.us)} µs`;
    case "data_in":
    case "cs_insert":
    case "cs_evict":
      return `${e.bytes} B`;
    case "upstream_out":
      return `→ ${e.nextHop}`;
    case "drop":
    case "bypass":
    case "pit_expire":
      return e.reason ?? "";
    default:
      return "";
  }
}

/** Virtual milliseconds as a short time. */
function fmtVirtual(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${fixed(ms / 1000, 2)} s`;
}

/** An attack's verdict in the visitor's language (the simulator words its own details in English). */
function attackDetail(a: AttackRecord & { caughtAt?: string }, r: SwarmStrings["attackResult"]): string {
  switch (a.kind) {
    case "tamper":
      if (a.caughtAt !== undefined) return r.tamperCaught(a.caughtAt);
      if (!a.rejected) return r.tamperMissed;
      return a.detail.startsWith("no Data") ? r.tamperIdle : r.tamperRejected;
    case "forge":
      return a.rejected ? r.forgeOk : r.forgeMissed(a.detail);
    case "private-probe":
      return a.rejected ? r.probeOk : r.probeLeak;
  }
}

/** The protocols in the order their panes appear. */
const COMPARE_ORDER: CompareMode[] = ["mcp-direct", "mcp-local-cache", "idem"];
/** The player's speeds (virtual time per real time). */
const SPEEDS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2] as const;

/** An issue in the visitor's language. */
function issueText(i: Issue, t: EditorStrings["issues"], name: (id: string) => string): string {
  switch (i.kind) {
    case "no-agents":
    case "no-producers":
      return t[i.kind];
    case "agent-no-tools":
      return t[i.kind](i.node);
    case "tool-unreachable":
    case "tool-not-served":
      return t[i.kind](i.node, name(i.producer), i.tool);
  }
}

/**
 * The network editor (ADR-028): the visitor's network on the stage, editable, and run by the
 * simulator (the real `@idem/core` forwarders and producers over virtual links, on a seeded virtual
 * clock) once per compared protocol, side by side. Moving a node never restarts a run; any other
 * change restarts it (debounced). With the NDN engine, the forwarders are real NDN routers instead
 * (`ndn-engine.tsx`).
 */
export function EditorMode({ nw, net }: { nw: NetworkState; net: Network }) {
  const t = useMessages(sandbox);
  const ts = t.swarm;
  const te = useMessages(editor);
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(true);
  const [views, setViews] = useState<RunView[]>([]);
  const [attacks, setAttacks] = useState<(AttackRecord & { caughtAt?: string })[]>([]);
  const [logVersion, setLogVersion] = useState(0);
  const [logSource, setLogSource] = useState<SimMode>("idem");
  const [kindFilter, setKindFilter] = useState<Set<ForwarderEventKind>>(new Set());
  const [nodeFilter, setNodeFilter] = useState("all");
  const [highlight, setHighlight] = useState<string>();
  const [focus, setFocus] = useState<{ run: SimMode; node: string }>({ run: "idem", node: "" });
  const [table, setTable] = useState<TableSnapshot>();
  const [named, setNamed] = useState<NameSnapshot>();
  const [metricsRun, setMetricsRun] = useState<SimMode>("idem");
  const [sel, setSel] = useState<EditorSelection>();
  const [target, setTarget] = useState<string>("");
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1 }).current;
  const handle = useRef<StageEditorHandle | null>(null);
  const runs = useRef<NetworkRun[]>([]);
  const vt = useRef(0);
  const netRef = useRef(net);
  netRef.current = net;
  const speed = useRef(net.run.speed);
  speed.current = net.run.speed;
  const [generation, setGeneration] = useState(0);
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const selRef = useRef(sel);
  selRef.current = sel;
  const attackCount = useRef(0);
  /** The latest restart; an older one that finishes later is dropped. */
  const startSeq = useRef(0);
  const lastLoads = useRef(-1);

  const problems = useMemo(() => issues(net), [net]);
  const ndn = net.run.engine === "ndn";
  const runnable = problems.length === 0 && !ndn;
  const hasIdem = net.run.compare.includes("idem");
  const canAttack = runnable && hasIdem;
  const sig = useMemo(() => runSignature(net), [net]);
  const producers = producerNodes(net);
  const nameOf = (id: string) => producers.find((p) => p.id === id)?.config.name ?? id;

  // Reduced motion: never autoplay.
  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  const fit = useCallback(() => {
    const first = runs.current[0];
    const fr = splitPanes(wsRef.current.area, runs.current.length || 1)[0];
    if (first && fr && fr.w > 2) first.scene.fit(fr);
  }, []);

  // (Re)start every run when what the network does changes. A newly loaded network pops in and is
  // fitted; an edit restarts in place.
  const restart = useCallback(
    async (n: Network, entrance: boolean) => {
      const my = ++startSeq.current;
      const ok = issues(n).length === 0 && n.run.engine === "idem";
      const modes: SimMode[] = ok ? COMPARE_ORDER.filter((m) => n.run.compare.includes(m)) : ["idem"];
      const next = modes.map((mode) => new NetworkRun(mode));
      await Promise.all(next.map((r) => r.start(n, camera, ok, entrance ? performance.now() : 0)));
      if (my !== startSeq.current) return;
      for (const r of next) r.scene.highlight = highlightRef.current;
      runs.current = next;
      // A node dragged while this run was being built: the scenes take its current position.
      for (const r of next) for (const node of netRef.current.nodes) r.scene.move(node.id, node.x, node.y);
      vt.current = 0;
      attackCount.current = 0;
      setAttacks([]);
      if (entrance) fit();
      const idem = next.find((r) => r.mode === "idem");
      const ids = idem?.forwarderIds() ?? [];
      const f = focusRef.current;
      const node = ids.includes(f.node) ? f.node : (ids[0] ?? "");
      const main: SimMode = modes.includes("idem") ? "idem" : (modes[0] ?? "idem");
      setFocus({ run: "idem", node });
      setLogSource((s) => (modes.includes(s) ? s : main));
      setMetricsRun((s) => (modes.includes(s) ? s : main));
      setGeneration((g) => g + 1);
    },
    [camera, fit],
  );

  useEffect(() => {
    void sig;
    const load = lastLoads.current !== nw.loads;
    if (load) setSel(undefined);
    const loads = nw.loads;
    // The load is marked as seen when its restart fires, so a cancelled timer (StrictMode) keeps it.
    const id = setTimeout(
      () => {
        lastLoads.current = loads;
        void restart(netRef.current, load);
      },
      load ? 0 : 250,
    );
    return () => clearTimeout(id);
  }, [sig, nw.loads, restart]);

  // Positions (a drag, an undo of one) move the drawn nodes without restarting anything.
  useEffect(() => {
    for (const r of runs.current) for (const n of net.nodes) r.scene.move(n.id, n.x, n.y);
  }, [net.nodes]);

  // A selection whose node or link is gone is dropped; the attack target follows the producers.
  useEffect(() => {
    const s = selRef.current;
    if (s?.kind === "node" && !net.nodes.some((n) => n.id === s.id)) setSel(undefined);
    if (s?.kind === "link" && !net.links.some((l) => l.id === s.id)) setSel(undefined);
    const names = producerNodes(net).map((p) => p.config.name);
    setTarget((cur) => (names.includes(cur) ? cur : (names[0] ?? "")));
  }, [net]);

  useEffect(() => {
    for (const r of runs.current) r.scene.highlight = highlight;
  }, [highlight]);

  // Clock: virtual time advances by real time × speed, every frame, while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      vt.current += dt * speed.current;
      for (const r of runs.current) r.advance(vt.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Counters, tables and the log: sampled at 8 Hz, never per frame.
  useEffect(() => {
    const sample = () => {
      const w = wsRef.current;
      const next = runs.current.map((r) => {
        const tables = r.tables();
        for (const [id, s] of Object.entries(tables)) r.scene.setState(id, s);
        return {
          mode: r.mode,
          metrics: r.metrics(),
          tables,
          ...(r.sim && { counts: { ...r.sim.metrics.counts } }),
          done: r.sim?.done ?? false,
          now: r.now,
          ...(r.error !== undefined && { error: r.error }),
          nodes: [...r.scene.nodes.values()],
        };
      });
      setViews(next);
      const idem = runs.current.find((r) => r.mode === "idem");
      const list = idem ? idem.attackView() : [];
      setAttacks(list);
      if (list.length > attackCount.current) w.reveal("safety");
      attackCount.current = list.length;
      const f = focusRef.current;
      const focusRun = runs.current.find((r) => r.mode === f.run);
      setTable(w.isOpen("tables") && focusRun && f.node ? focusRun.table(f.node) : undefined);
      const h = highlightRef.current;
      setNamed(w.isOpen("inspector") && idem && h ? idem.inspect(h) : undefined);
      setLogVersion((v) => v + 1);
    };
    sample();
    const id = setInterval(sample, 125);
    return () => clearInterval(id);
  }, []);

  const edit = useCallback(
    (next: Network, coalesce?: string) => nw.edit(next, coalesce ? { coalesce } : undefined),
    [nw],
  );
  const setRun = (patch: Partial<Network["run"]>, key: string) =>
    edit({ ...netRef.current, run: { ...netRef.current.run, ...patch } }, `run.${key}`);
  const idemRun = () => runs.current.find((r) => r.mode === "idem");

  const follow = useCallback(
    (name: string | undefined) => {
      setHighlight(name);
      if (name) ws.reveal("inspector");
    },
    [ws],
  );

  // ---------------------------------------------------------------- editing

  const connect = useCallback(
    (a: string, b: string) => {
      const [linked, id] = addLink(netRef.current, a, b);
      if (id) edit(autoToolsAll(linked));
    },
    [edit],
  );

  const removeSelected = useCallback(() => {
    const s = selRef.current;
    if (!s) return;
    edit(s.kind === "node" ? removeNode(netRef.current, s.id) : removeLink(netRef.current, s.id));
    setSel(undefined);
  }, [edit]);

  /** Add a node: at a world point (a drop), or next to the selected node and linked to it. */
  const add = useCallback(
    (kind: NetNodeKind, at?: [number, number]) => {
      let n = netRef.current;
      const s = selRef.current;
      const near = !at && s?.kind === "node" ? n.nodes.find((x) => x.id === s.id) : undefined;
      const jitter = () => (Math.random() - 0.5) * 60;
      const [x, y] = at ?? (near ? placeNear(n, near, kind) : [camera.x + jitter(), camera.y + jitter()]);
      let id: string;
      [n, id] = addNode(n, kind, Math.round(x), Math.round(y));
      const to = near ? attachTo(n, near, kind) : undefined;
      if (to && !linkProblem(n, to, id)) [n] = addLink(n, to, id);
      edit(autoToolsAll(n));
      setSel({ kind: "node", id });
    },
    [camera, edit],
  );

  const editorProps: StageEditor = {
    camera,
    fitKey: nw.loads,
    selected: sel,
    onSelect: setSel,
    onMove: (id, x, y, done) => {
      if (done) edit(moveNode(netRef.current, id, x, y), `move.${id}`);
    },
    canLink: (a, b) => !linkProblem(netRef.current, a, b),
    onLink: connect,
    linkId: (a, b) => linkBetween(netRef.current, a, b)?.id,
    handle,
    labels: te.canvas,
  };

  // Keys: Space plays or pauses, R restarts, Esc clears, Delete removes, arrows move, ⌘Z undoes, F fits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const field = !!el && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName));
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
        if (field && el?.tagName !== "INPUT") return;
        if (
          field &&
          (el as HTMLInputElement).type !== "range" &&
          (el as HTMLInputElement).type !== "checkbox"
        )
          return;
        e.preventDefault();
        if (e.key === "y" || e.shiftKey) nw.redo();
        else nw.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || field) return;
      const s = selRef.current;
      if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void restart(netRef.current, false);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fit();
      } else if (e.key === "Escape") {
        setHighlight(undefined);
        setSel(undefined);
      } else if ((e.key === "Delete" || e.key === "Backspace") && s) {
        e.preventDefault();
        removeSelected();
      } else if (s?.kind === "node" && e.key.startsWith("Arrow") && !el?.closest(".obs-node-keys")) {
        const n = netRef.current.nodes.find((x) => x.id === s.id);
        if (!n) return;
        const d = e.shiftKey ? 40 : 10;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        e.preventDefault();
        edit(moveNode(netRef.current, n.id, n.x + dx, n.y + dy), `move.${n.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restart, fit, removeSelected, edit, nw]);

  const onNodeClick = (pane: string, node: string) => {
    setSel({ kind: "node", id: node });
    const run = runs.current.find((r) => r.mode === pane);
    if (!run?.sim?.forwarders.has(node)) return;
    setFocus({ run: run.mode, node });
  };

  const attack = (fn: () => void) => {
    fn();
    ws.reveal("safety");
  };

  // The Add palette: drag a chip onto the stage, or click it.
  const stageEl = useRef<HTMLElement | null>(null);
  stageEl.current = ws.slots.stage ?? null;
  const drag = useDragToStage<NetNodeKind>({
    stage: stageEl,
    onDrop: (kind, at) => {
      const w = handle.current?.worldAt(at.x, at.y);
      if (w) add(kind, w);
    },
    render: (kind) => (
      <>
        <NodeGlyph kind={kind} />
        <span className="obs-drag-name">{te.add[kind]}</span>
      </>
    ),
  });

  const total = totalCalls(net);
  const allDone = views.length > 0 && views.every((v) => v.done);
  // Calls answered or failed so far, in the slowest run.
  const progress = views.length
    ? Math.min(...views.map((v) => (v.metrics ? v.metrics.completed + v.metrics.failed : 0)))
    : 0;
  const now = views[0]?.now ?? 0;
  const modes = views.map((v) => v.mode);

  // Event log rows (bounded).
  const logRun = runs.current.find((r) => r.mode === logSource) ?? runs.current[0];
  const logNodes = useMemo(() => {
    void logVersion;
    return [...new Set((logRun?.events ?? []).map((l) => l.e.node))].sort();
  }, [logRun, logVersion]);
  const rows = useMemo(() => {
    void logVersion;
    const src = logRun?.events ?? [];
    const out: LoggedEvent[] = [];
    for (let i = src.length - 1; i >= 0 && out.length < 150; i--) {
      const l = src[i];
      if (!l) continue;
      if (kindFilter.size > 0 && !kindFilter.has(l.e.kind)) continue;
      if (nodeFilter !== "all" && l.e.node !== nodeFilter) continue;
      out.push(l);
    }
    return out;
  }, [logRun, logVersion, kindFilter, nodeFilter]);

  const safety: SafetyItem[] = attacks
    .map((a, i) => ({
      id: `${generation}-${a.kind}-${a.t}-${i}`,
      title: `${t.safety.kinds[a.kind]} · t = ${fmtVirtual(a.t)}`,
      ok: a.rejected,
      detail: attackDetail(a, ts.attackResult),
    }))
    .reverse();

  const focusIds = runs.current.find((r) => r.mode === focus.run)?.forwarderIds() ?? [];
  const agentCount = net.nodes.filter((n) => n.kind === "agent").length;

  return (
    <>
      {drag.ghost}
      <Slot name="controls">
        <Section title={te.run.engine} aside={<InfoTip label={te.run.engine}>{te.run.tips.engine}</InfoTip>}>
          <Segmented
            label={te.run.engine}
            value={net.run.engine}
            onChange={(v) => setRun({ engine: v }, "engine")}
            options={[
              {
                value: "idem",
                label: (
                  <span className="obs-mode">
                    {te.run.engineIdem}
                    <span className="obs-mode-hint">{te.run.engineIdemHint}</span>
                  </span>
                ),
              },
              {
                value: "ndn",
                label: (
                  <span className="obs-mode">
                    {te.run.engineNdn}
                    <span className="obs-mode-hint">{te.run.engineNdnHint}</span>
                  </span>
                ),
              },
            ]}
          />
          {!ndn && (
            <>
              <fieldset className="obs-field">
                <legend className="sr-only">{te.run.compare}</legend>
                <Label tip={te.run.tips.compare}>{te.run.compare}</Label>
                {COMPARE_ORDER.map((m) => (
                  <Check
                    key={m}
                    label={te.run.compareModes[m]}
                    checked={net.run.compare.includes(m)}
                    onChange={(v) => {
                      const next = v
                        ? COMPARE_ORDER.filter((x) => x === m || net.run.compare.includes(x))
                        : net.run.compare.filter((x) => x !== m);
                      if (next.length > 0) setRun({ compare: next }, "compare");
                    }}
                  />
                ))}
              </fieldset>
              <div className="obs-field">
                <Label htmlFor="net-seed" tip={ts.tips.seed}>
                  {ts.seed}
                </Label>
                <div className="flex gap-2">
                  <input
                    id="net-seed"
                    type="number"
                    value={net.run.seed}
                    min={0}
                    onChange={(e) =>
                      setRun({ seed: Math.max(0, Math.round(Number(e.target.value) || 0)) }, "seed")
                    }
                    className="obs-input t-mono min-w-0 flex-1"
                  />
                  <Button
                    onClick={() => setRun({ seed: Math.floor(Math.random() * 100_000) }, "seed-shuffle")}
                    title={ts.shuffleTitle}
                  >
                    {ts.shuffle}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Section>
        <Section title={te.add.title}>
          <div className="obs-palette">
            {(["agent", "forwarder", "producer"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="obs-chip-node"
                title={`${te.add.tips[kind]}`}
                {...drag.bind(kind)}
                onClick={() => {
                  if (!drag.clickWasDrag()) add(kind);
                }}
              >
                <NodeGlyph kind={kind} />
                {te.add[kind]}
              </button>
            ))}
          </div>
          <p className="obs-note">{te.add.hint}</p>
        </Section>
        {!ndn && (
          <Section title={ts.attacks} defaultOpen={false}>
            {producers.length > 1 && (
              <div className="obs-field">
                <Label htmlFor="net-target">{te.attacks.target}</Label>
                <select
                  id="net-target"
                  className="obs-select"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  {producers.map((p) => (
                    <option key={p.id} value={p.config.name}>
                      {p.config.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button
                wide
                disabled={!canAttack}
                onClick={() => attack(() => idemRun()?.sim?.attackTamper(target))}
              >
                {ts.attack.tamper}
              </Button>
              <Button
                wide
                disabled={!canAttack}
                onClick={() => attack(() => void idemRun()?.sim?.attackForge(0, target))}
              >
                {ts.attack.forge}
              </Button>
              <Button
                wide
                disabled={!canAttack || agentCount < 2}
                onClick={() => attack(() => void idemRun()?.sim?.attackPrivateProbe(0, 1, target))}
              >
                {ts.attack.probe}
              </Button>
            </div>
            <p className="obs-note">
              {!hasIdem ? te.attacks.needsIdem : playing ? t.live.attackHint : ts.resolveHint}
            </p>
          </Section>
        )}
      </Slot>

      <Slot name="aside">
        <SelectionCard
          net={net}
          sel={sel}
          edit={edit}
          onSelect={setSel}
          onDelete={removeSelected}
          onConnect={connect}
        />
      </Slot>

      {ndn ? (
        <NdnEngine net={net} loads={nw.loads} editor={editorProps} />
      ) : (
        <>
          <Slot name="stage">
            <StageCanvas
              panes={views.flatMap((v) => {
                const run = runs.current.find((r) => r.mode === v.mode);
                if (!run) return [];
                return {
                  key: v.mode,
                  scene: run.scene,
                  now: () => run.now,
                  nodes: v.nodes,
                  title: views.length > 1 || runnable ? ts.modeLabel[v.mode] : undefined,
                  note: v.error ? ts.error(v.error) : runnable ? ts.modeNote[v.mode] : undefined,
                  agentLabels: true,
                  badges: Object.fromEntries(
                    Object.entries(v.tables)
                      .filter(([, s]) => s.pit > 0 || s.cs > 0)
                      .map(([id, s]) => [
                        id,
                        <span key={id} className="obs-badges">
                          {s.pit > 0 && <span className="text-interest">PIT {s.pit}</span>}
                          {s.cs > 0 && <span className="text-data">CS {s.cs}</span>}
                        </span>,
                      ]),
                  ),
                };
              })}
              area={ws.area}
              label={te.canvas.label}
              onNodeClick={onNodeClick}
              nodeAction={(_pane, n) => te.canvas.select(n.id)}
              editor={editorProps}
            />
          </Slot>

          <Slot name="player">
            <PlayerButton
              label={ts.restart}
              kbd="R"
              disabled={!runnable}
              onClick={() => void restart(netRef.current, false)}
            >
              <RestartIcon />
            </PlayerButton>
            <PlayerButton
              primary
              label={playing ? ts.pause : ts.play}
              kbd="Space"
              disabled={!runnable}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </PlayerButton>
            <PlayerSep />
            {runnable ? (
              <>
                <span className="obs-ptime">
                  <span className="t-mono tabular-nums text-fg">{fmtVirtual(now)}</span>
                  <span className="obs-ptime-note">{allDone ? ts.done : ts.virtual}</span>
                </span>
                <PlayerProgress
                  value={allDone ? 1 : progress / Math.max(1, total)}
                  label={`${allDone ? total : Math.min(total, progress)}/${total}`}
                  title={te.run.progress}
                />
                <PlayerSep />
                <SpeedMenu
                  value={net.run.speed}
                  presets={SPEEDS}
                  label={ts.speed}
                  onChange={(v) => setRun({ speed: v }, "speed")}
                />
              </>
            ) : (
              <PlayerIssues
                title={te.run.cannotRun}
                items={problems.map((i) => issueText(i, te.issues, nameOf))}
              />
            )}
          </Slot>
        </>
      )}

      <Slot name="hint:tables">{focus.node ? `${focus.node} · ${ts.modeLabel[focus.run]}` : ""}</Slot>
      <Slot name="hint:log">{ndn ? te.ndn.title : ts.modeLabel[logSource]}</Slot>
      <Slot name="hint:metrics">{ndn ? te.ndn.title : ts.modeLabel[metricsRun]}</Slot>
      <Slot name="hint:inspector">{highlight ? shortName(highlight) : ""}</Slot>

      {!ndn && (
        <Slot name="win:log">
          <SwarmLog
            rows={rows}
            modes={modes}
            logSource={logSource}
            setLogSource={setLogSource}
            nodes={logNodes}
            nodeFilter={nodeFilter}
            setNodeFilter={setNodeFilter}
            kindFilter={kindFilter}
            setKindFilter={setKindFilter}
            highlight={highlight}
            follow={follow}
            labels={ts}
          />
        </Slot>
      )}
      <Slot name="win:tables">
        <SwarmTables
          snapshot={table}
          ids={focusIds}
          node={focus.node}
          onNode={(node) => setFocus((f) => ({ ...f, node }))}
          follow={follow}
          labels={ts.tables}
        />
      </Slot>
      <Slot name="win:inspector">
        {named ? (
          <SwarmInspector snap={named} labels={ts.inspector} details={ts.log.detail} />
        ) : (
          <Empty>{ts.inspector.empty}</Empty>
        )}
      </Slot>
      {!ndn && (
        <>
          <Slot name="win:metrics">
            <SwarmMetrics
              views={views}
              modes={modes}
              run={metricsRun}
              setRun={setMetricsRun}
              total={total}
              labels={ts}
            />
          </Slot>
          <Slot name="win:compare">
            <SwarmCompare views={views} total={total} labels={ts} />
          </Slot>
        </>
      )}
      <Slot name="win:safety">
        <SafetyList items={safety} labels={t.safety} />
      </Slot>
    </>
  );
}

function SwarmLog({
  rows,
  modes,
  logSource,
  setLogSource,
  nodes,
  nodeFilter,
  setNodeFilter,
  kindFilter,
  setKindFilter,
  highlight,
  follow,
  labels,
}: {
  rows: LoggedEvent[];
  modes: SimMode[];
  logSource: SimMode;
  setLogSource: (m: SimMode) => void;
  nodes: string[];
  nodeFilter: string;
  setNodeFilter: (n: string) => void;
  kindFilter: Set<ForwarderEventKind>;
  setKindFilter: (f: (s: Set<ForwarderEventKind>) => Set<ForwarderEventKind>) => void;
  highlight: string | undefined;
  follow: (name: string | undefined) => void;
  labels: SwarmStrings;
}) {
  const l = labels.log;
  return (
    <div className="flex min-h-full flex-col">
      <div className="obs-toolbar">
        <select
          aria-label={l.run}
          value={logSource}
          onChange={(e) => setLogSource(e.target.value as SimMode)}
          className="obs-select"
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              {labels.modeLabel[m]}
            </option>
          ))}
        </select>
        <select
          aria-label={l.node}
          value={nodeFilter}
          onChange={(e) => setNodeFilter(e.target.value)}
          className="obs-select"
        >
          <option value="all">{l.allNodes}</option>
          {nodes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {highlight && (
          <button type="button" className="obs-follow" onClick={() => follow(undefined)}>
            <span className="text-faint">{l.following}</span> {shortName(highlight)}{" "}
            <span aria-hidden="true">×</span>
            <span className="sr-only">{l.clear}</span>
          </button>
        )}
      </div>
      <fieldset className="obs-chips">
        <legend className="sr-only">{l.kinds}</legend>
        {LOG_KINDS.map((k) => {
          const on = kindFilter.has(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              className={`obs-chip ${kindTone(k)}`}
              onClick={() =>
                setKindFilter((s) => {
                  const n = new Set(s);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                })
              }
            >
              {k}
            </button>
          );
        })}
      </fieldset>
      {rows.length === 0 ? (
        <Empty>{l.empty}</Empty>
      ) : (
        <table className="obs-table obs-table-log">
          <tbody>
            {rows.map((r) => {
              const name = "name" in r.e ? r.e.name : undefined;
              return (
                <tr key={r.seq} data-selected={(name && name === highlight) || undefined}>
                  <td className="w-14 text-right text-faint tabular-nums">{Math.round(r.e.t)}</td>
                  <td className="text-muted">{r.e.node}</td>
                  <td className={kindTone(r.e.kind)}>{r.e.kind}</td>
                  <td>
                    {name ? (
                      <button
                        type="button"
                        className={`obs-name-btn ${name === highlight ? "text-interest" : ""}`}
                        title={name}
                        onClick={() => follow(name === highlight ? undefined : name)}
                      >
                        {shortName(name)}
                      </button>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="text-right text-faint">{detail(r.e, l.detail)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="obs-win-foot">{l.footer(rows.length)}</p>
    </div>
  );
}

function SwarmTables({
  snapshot,
  ids,
  node,
  onNode,
  follow,
  labels,
}: {
  snapshot: TableSnapshot | undefined;
  ids: string[];
  node: string;
  onNode: (n: string) => void;
  follow: (name: string) => void;
  labels: SwarmStrings["tables"];
}) {
  return (
    <div className="flex flex-col">
      {ids.length > 1 && (
        <div className="obs-toolbar">
          <Segmented
            label={labels.forwarder}
            value={node}
            options={ids.map((id) => ({ value: id, label: <span className="t-mono">{id}</span> }))}
            onChange={onNode}
          />
        </div>
      )}
      {!snapshot ? (
        <Empty>{labels.clickHint}</Empty>
      ) : (
        <>
          <div className="obs-block">
            <h3 className="obs-block-title">
              {labels.pending} <span className="t-mono text-interest">{snapshot.pit.length}</span>
            </h3>
            {snapshot.pit.length === 0 ? (
              <p className="obs-empty-inline">{labels.empty}</p>
            ) : (
              <table className="obs-table">
                <thead>
                  <tr>
                    <th>{labels.name}</th>
                    <th>{labels.scope}</th>
                    <th className="text-right">{labels.waiting}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.pit.map((e, i) => (
                    <tr key={`${e.name}-${e.scope}-${i}`}>
                      <td>
                        <button
                          type="button"
                          className="obs-name-btn text-interest"
                          onClick={() => follow(e.name)}
                        >
                          {shortName(e.name)}
                        </button>
                      </td>
                      <td className={e.scope === "private" ? "text-interest" : "text-muted"}>{e.scope}</td>
                      <td className="text-right tabular-nums">
                        <span className="obs-dots" aria-hidden="true">
                          {Array.from({ length: Math.min(12, e.waiting) }, (_, i) => (
                            <span key={i} />
                          ))}
                        </span>{" "}
                        {e.waiting}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="obs-block">
            <h3 className="obs-block-title">
              {labels.cache}{" "}
              <span className="t-mono text-muted">
                {labels.occupancy(snapshot.entries, fmtBytes(snapshot.bytes), fmtBytes(snapshot.maxBytes))}
              </span>
            </h3>
            <span className="obs-bar" data-tone="data" aria-hidden="true">
              <span
                style={{ transform: `scaleX(${snapshot.maxBytes ? snapshot.bytes / snapshot.maxBytes : 0})` }}
              />
            </span>
            {snapshot.cs.length === 0 ? (
              <p className="obs-empty-inline">{labels.empty}</p>
            ) : (
              <table className="obs-table">
                <thead>
                  <tr>
                    <th>{labels.name}</th>
                    <th>{labels.fresh}</th>
                    <th className="text-right">{labels.hits}</th>
                    <th className="text-right">{labels.size}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.cs.map((e) => (
                    <tr key={e.key} data-stale={e.leftMs <= 0 || undefined}>
                      <td>
                        <button
                          type="button"
                          className="obs-name-btn text-data"
                          onClick={() => follow(e.name)}
                        >
                          {shortName(e.name)}
                        </button>
                        {e.scope === "private" && <span className="text-interest"> · private</span>}
                      </td>
                      <td>
                        <span className="obs-fresh">
                          <span className="obs-bar" data-tone="data" aria-hidden="true">
                            <span
                              style={{
                                transform: `scaleX(${Math.max(0, Math.min(1, e.leftMs / e.freshnessMs))})`,
                              }}
                            />
                          </span>
                          <span className="tabular-nums">
                            {e.leftMs > 0 ? fmtVirtual(e.leftMs) : labels.stale}
                          </span>
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{e.hits}</td>
                      <td className="text-right text-muted tabular-nums">{fmtBytes(e.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SwarmInspector({
  snap,
  labels,
  details,
}: {
  snap: NameSnapshot;
  labels: SwarmStrings["inspector"];
  details: SwarmStrings["log"]["detail"];
}) {
  const first = snap.cached[0];
  const data = first?.data;
  const contentOk = useContentCheck(data);
  const checks = snap.events.filter((l) => l.e.kind === "verify_ok" || l.e.kind === "verify_fail");
  return (
    <div className="obs-inspector">
      <Field label={labels.name}>
        <NameParts name={snap.name} labels={labels.parts} />
      </Field>
      <Field label={labels.cachedAt}>
        {snap.cached.length === 0 ? (
          <p className="text-faint">{labels.notCached}</p>
        ) : (
          <ul className="obs-trace">
            {snap.cached.map((c) => (
              <li key={`${c.node}-${c.key}`}>
                <span className="text-fg">{c.node}</span>
                <span className="text-faint"> · </span>
                <span className={c.leftMs > 0 ? "text-data" : "text-faint"}>
                  {c.leftMs > 0 ? labels.fresh(fmtVirtual(c.leftMs)) : labels.stale}
                </span>
                <span className="text-faint"> · </span>
                <span className="text-muted">
                  {labels.hits(c.hits)} · {fmtBytes(c.bytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Field>
      {data && (
        <>
          <DataFacts data={data} producedAt={`t = ${fmtVirtual(data.meta.producedAt)}`} labels={labels} />
          <DigestCheck label={labels.contentCheck} ok={contentOk} yes={labels.match} no={labels.mismatch} />
          {data.meta.scope === "private" && <p className="obs-note">{labels.privateNote}</p>}
        </>
      )}
      <Field label={labels.checks}>
        {checks.length === 0 ? (
          <p className="text-faint">{labels.noChecks}</p>
        ) : (
          <ul className="obs-trace">
            {checks.map((l) => (
              <li key={l.seq}>
                <span className="text-fg">{l.e.node}</span>
                <span className="text-faint"> · </span>
                <span className={l.e.kind === "verify_ok" ? "text-data" : "text-fg"}>
                  {l.e.kind === "verify_ok" ? "✓" : "✕"} {l.e.kind}
                </span>
                <span className="text-faint"> · {detail(l.e, details)}</span>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label={labels.events}>
        <ul className="obs-trace">
          {snap.events.map((l) => (
            <li key={l.seq}>
              <span className="text-faint tabular-nums">{Math.round(l.e.t)}</span>{" "}
              <span className="text-fg">{l.e.node}</span>{" "}
              <span className={kindTone(l.e.kind)}>{l.e.kind}</span>{" "}
              <span className="text-faint">{detail(l.e, details)}</span>
            </li>
          ))}
        </ul>
      </Field>
    </div>
  );
}

function SwarmMetrics({
  views,
  modes,
  run,
  setRun,
  total,
  labels,
}: {
  views: RunView[];
  modes: SimMode[];
  run: SimMode;
  setRun: (m: SimMode) => void;
  total: number;
  labels: SwarmStrings;
}) {
  const l = labels.metrics;
  const v = views.find((x) => x.mode === run) ?? views[views.length - 1];
  const m = v?.metrics;
  const idem = v?.mode === "idem" || v?.mode === "idem-noverify";
  const counts = v?.counts;
  const maxCount = Math.max(1, ...Object.values(counts ?? {}));
  return (
    <div className="flex flex-col">
      <div className="obs-toolbar">
        <Segmented
          label={labels.log.run}
          value={v?.mode ?? run}
          options={modes.map((x) => ({ value: x, label: labels.modeLabel[x] }))}
          onChange={setRun}
        />
      </div>
      {v?.error ? (
        <Empty>{labels.error(v.error)}</Empty>
      ) : (
        <div className="obs-stats">
          <Stat
            label={l.upstream}
            value={m?.upstreamCalls ?? 0}
            tone="interest"
            bar={(m?.upstreamCalls ?? 0) / Math.max(1, total)}
          />
          <Stat
            label={l.completed}
            value={`${m?.completed ?? 0}/${total}`}
            bar={(m?.completed ?? 0) / Math.max(1, total)}
            hint={m?.failed ? l.failed(m.failed) : undefined}
          />
          <Stat label={l.hitRatio} value={idem ? fmtPct(m?.csHitRatio ?? 0) : "—"} tone="data" />
          <Stat label={l.aggregations} value={idem ? (m?.pitAggregations ?? 0) : "—"} tone="interest" />
          <Stat label={l.producerLink} value={fmtBytes(m?.producerLinkBytes ?? 0)} />
          <Stat label={l.p50} value={fmtMs(m?.latencyMs.p50 ?? Number.NaN)} />
          <Stat label={l.p95} value={fmtMs(m?.latencyMs.p95 ?? Number.NaN)} />
          <Stat label={l.verifyFailures} value={m?.verifyFailures ?? 0} />
          <Stat label={l.safety} value={m?.safetyViolations ?? 0} />
          <Stat label={l.retries} value={m?.retries ?? 0} />
          {v?.mode === "mcp-local-cache" && (
            <Stat label={l.localHits} value={m?.localCacheHits ?? 0} tone="data" />
          )}
        </div>
      )}
      {counts && (
        <div className="obs-block">
          <h3 className="obs-block-title">{l.events}</h3>
          <ul className="obs-counts">
            {LOG_KINDS.filter((k) => (counts[k] ?? 0) > 0).map((k) => (
              <li key={k}>
                <span className={`t-mono ${kindTone(k)}`}>{k}</span>
                <span className="obs-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${(counts[k] ?? 0) / maxCount})` }} />
                </span>
                <span className="t-mono tabular-nums text-muted">{counts[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SwarmCompare({ views, total, labels }: { views: RunView[]; total: number; labels: SwarmStrings }) {
  const c = labels.compare;
  const rows: {
    label: string;
    get: (m: Metrics | undefined, v: RunView) => number;
    fmt: (n: number) => string;
    idemOnly?: boolean;
  }[] = [
    { label: c.upstream, get: (m) => m?.upstreamCalls ?? 0, fmt: String },
    { label: c.completed, get: (m) => m?.completed ?? 0, fmt: (n) => `${n}/${total}` },
    { label: c.hitRatio, get: (m) => m?.csHitRatio ?? 0, fmt: fmtPct, idemOnly: true },
    { label: c.aggregations, get: (m) => m?.pitAggregations ?? 0, fmt: String, idemOnly: true },
    { label: c.producerLink, get: (m) => m?.producerLinkBytes ?? 0, fmt: fmtBytes },
    { label: c.p50, get: (m) => m?.latencyMs.p50 ?? Number.NaN, fmt: fmtMs },
    { label: c.p95, get: (m) => m?.latencyMs.p95 ?? Number.NaN, fmt: fmtMs },
    { label: c.verifyFailures, get: (m) => m?.verifyFailures ?? 0, fmt: String },
  ];
  const direct = views.find((v) => v.mode === "mcp-direct")?.metrics?.upstreamCalls ?? 0;
  const idem = views.find((v) => v.mode === "idem")?.metrics?.upstreamCalls ?? 0;
  return (
    <div className="flex flex-col">
      <table className="obs-table obs-table-compare">
        <thead>
          <tr>
            <th>{c.metric}</th>
            {views.map((v) => (
              <th key={v.mode} className="text-right" data-run={v.mode}>
                {labels.modeLabel[v.mode]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const vals = views.map((v) => r.get(v.metrics, v));
            const max = Math.max(1e-9, ...vals.filter((x) => Number.isFinite(x)));
            return (
              <tr key={r.label}>
                <td className="text-muted">{r.label}</td>
                {views.map((v, i) => {
                  const x = vals[i] ?? 0;
                  const na = r.idemOnly && v.mode !== "idem" && v.mode !== "idem-noverify";
                  return (
                    <td key={v.mode} className="text-right" data-run={v.mode}>
                      <span className="t-mono tabular-nums">{na ? "—" : r.fmt(x)}</span>
                      {!na && Number.isFinite(x) && (
                        <span
                          className="obs-bar obs-bar-cell"
                          aria-hidden="true"
                          data-tone={v.mode === "idem" ? "data" : undefined}
                        >
                          <span style={{ transform: `scaleX(${x / max})` }} />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {direct > 0 && <p className="obs-win-foot text-fg">{c.ratio(fmtPct(idem / direct))}</p>}
      <p className="obs-win-foot">{c.note}</p>
    </div>
  );
}
