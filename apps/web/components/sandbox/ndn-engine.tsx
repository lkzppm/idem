"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { editor as editorMessages } from "@/lib/i18n/messages/editor";
import { sandbox } from "@/lib/i18n/messages/sandbox";
import { splitPanes } from "@/lib/sandbox/layout";
import { browserYanfd, type NdnCall, NdnNetwork, type NdnStats } from "@/lib/sandbox/ndn-net";
import type { Network } from "@/lib/sandbox/network";
import { runSignature } from "@/lib/sandbox/run";
import { TopologyScene } from "@/lib/sandbox/scene";
import { PauseIcon, PlayIcon, RestartIcon } from "./icons";
import { PlayerButton, PlayerProgress, PlayerSep } from "./player";
import { StageCanvas, type StageEditor } from "./stage-canvas";
import { Empty, fixed, Stat, shortName } from "./ui";
import { Slot, useWorkspace } from "./workspace";

type Phase =
  | { kind: "loading"; loaded: number; total: number }
  | { kind: "starting" }
  | { kind: "running"; routers: number }
  | { kind: "failed"; why: string }
  | { kind: "unsupported" };

const LOG_CAP = 200;
/** Edits (a slider being dragged) settle before the routers are rebuilt. */
const BUILD_DEBOUNCE_MS = 400;

const mb = (n: number) => `${fixed(n / 1_000_000, 1)} MB`;

/**
 * The editor's NDN engine on the stage: the network runs on YaNFD routers compiled to WebAssembly,
 * one per forwarder node, in this tab and in real time (`lib/sandbox/ndn-net.ts`). It owns the
 * stage, the player bar, and the log, metrics and compare panels while it runs.
 */
export function NdnEngine({
  net,
  loads,
  editor,
  playing,
  onPlaying,
}: {
  net: Network;
  /** Bumped when another network is loaded: the stage is then fitted to it. */
  loads: number;
  editor: StageEditor;
  /** Agents send calls while playing; paused, they hold their next call. */
  playing: boolean;
  onPlaying: (v: boolean) => void;
}) {
  const t = useMessages(editorMessages);
  const tn = t.ndn;
  const ts = useMessages(sandbox).swarm;
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [stats, setStats] = useState<NdnStats>();
  const [calls, setCalls] = useState<NdnCall[]>([]);
  const [runId, setRunId] = useState(0);
  const scene = useMemo(() => {
    const s = new TopologyScene();
    s.camera = editor.camera;
    return s;
  }, [editor.camera]);
  const [nodes, setNodes] = useState(() => [...scene.nodes.values()]);
  const netRef = useRef(net);
  netRef.current = net;
  const sig = useMemo(() => runSignature(net), [net]);
  const log = useRef<NdnCall[]>([]);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const runningRef = useRef<NdnNetwork | undefined>(undefined);
  // After the first start, a rebuild keeps the player's texts as they are (no "starting…" flash).
  const started = useRef(false);
  const lastCalls = useRef(0);
  const fitted = useRef(-1);

  // The drawn network follows every change at once; a newly loaded one is fitted to the stage.
  useLayoutEffect(() => {
    void sig;
    scene.setTopology(netRef.current, 0);
    setNodes([...scene.nodes.values()]);
    if (fitted.current !== loads) {
      const fr = splitPanes(wsRef.current.area, 1)[0];
      if (fr && fr.w > 2) {
        scene.fit(fr);
        fitted.current = loads;
      }
    }
  }, [sig, loads, scene, ws.area.w > 2]);

  // Build and start the routers; rebuild when what the network does changes (not when a node
  // moves). Edits are debounced, and a build that is overtaken stops between routers and frees them.
  useEffect(() => {
    void sig;
    void runId;
    log.current = [];
    setCalls([]);
    setStats(undefined);
    if (typeof WebAssembly === "undefined") {
      setPhase({ kind: "unsupported" });
      return;
    }
    const abort = new AbortController();
    let running: NdnNetwork | undefined;
    const timer = setTimeout(() => {
      const n = netRef.current;
      const { factory, ready } = browserYanfd("/ndn/", (loaded, total) => {
        if (!abort.signal.aborted) setPhase({ kind: "loading", loaded, total });
      });
      void (async () => {
        try {
          await ready;
          if (abort.signal.aborted) return;
          if (!started.current) setPhase({ kind: "starting" });
          const made = await NdnNetwork.create(
            n,
            factory,
            {
              packet: (p) => scene.addPacket({ ...p, kind: p.kind }),
              flash: (node, kind) => scene.flash(node, kind),
              call: (c) => {
                log.current.push(c);
                if (log.current.length > LOG_CAP) log.current.splice(0, log.current.length - LOG_CAP);
              },
            },
            abort.signal,
          );
          if (abort.signal.aborted) {
            made.stop();
            return;
          }
          running = made;
          runningRef.current = made;
          if (!playingRef.current) made.pause();
          made.start();
          started.current = true;
          lastCalls.current = made.stats().calls;
          setPhase({ kind: "running", routers: n.nodes.filter((x) => x.kind === "forwarder").length });
        } catch (e) {
          if (!abort.signal.aborted)
            setPhase({ kind: "failed", why: e instanceof Error ? e.message : String(e) });
        }
      })();
    }, BUILD_DEBOUNCE_MS);
    const id = setInterval(() => {
      if (!running) return;
      const s = running.stats();
      setStats(s);
      for (const [fid, f] of Object.entries(s.forwarders))
        scene.setState(fid, { pit: f.pit, cs: f.csHits, fresh: 1 });
      setCalls([...log.current]);
    }, 250);
    return () => {
      abort.abort();
      clearTimeout(timer);
      clearInterval(id);
      running?.stop();
      if (runningRef.current === running) runningRef.current = undefined;
    };
  }, [sig, runId, scene]);

  // Pause holds the agents' next calls; play lets them go on.
  useEffect(() => {
    const r = runningRef.current;
    if (!r) return;
    if (playing) r.resume();
    else r.pause();
  }, [playing]);

  // Positions move the drawn nodes only.
  useEffect(() => {
    for (const n of net.nodes) scene.move(n.id, n.x, n.y);
  }, [net.nodes, scene]);

  const status =
    phase.kind === "loading"
      ? tn.loading(`${mb(phase.loaded)} / ${mb(phase.total)}`)
      : phase.kind === "starting"
        ? tn.starting
        : phase.kind === "running"
          ? tn.running(phase.routers)
          : phase.kind === "failed"
            ? tn.failed(phase.why)
            : tn.unsupported;

  const s = stats;
  const total = s?.calls ?? 0;
  return (
    <>
      <Slot name="stage">
        <StageCanvas
          panes={[
            {
              key: "ndn",
              scene,
              now: () => performance.now(),
              nodes,
              agentLabels: true,
              badges: Object.fromEntries(
                Object.entries(s?.forwarders ?? {})
                  .filter(([, f]) => f.pit > 0 || f.csHits > 0)
                  .map(([id, f]) => [
                    id,
                    <span key={id} className="obs-badges">
                      {f.pit > 0 && <span className="text-interest">PIT {f.pit}</span>}
                      {f.csHits > 0 && <span className="text-data">CS {f.csHits}</span>}
                    </span>,
                  ]),
              ),
            },
          ]}
          area={ws.area}
          label={t.canvas.label}
          onNodeClick={(_p, node) => editor.onSelect({ kind: "node", id: node })}
          nodeAction={(_p, n) => t.canvas.select(n.id)}
          editor={editor}
        />
      </Slot>
      <Slot name="player">
        <PlayerButton spin label={tn.restart} onClick={() => setRunId((r) => r + 1)}>
          <RestartIcon />
        </PlayerButton>
        <PlayerButton
          primary
          label={playing ? ts.pause : ts.play}
          kbd="Space"
          disabled={phase.kind !== "running"}
          onClick={() => onPlaying(!playing)}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </PlayerButton>
        <PlayerSep />
        <span className="obs-ptime" role="status">
          <span className="text-fg">{status}</span>
          {phase.kind === "running" && (
            <span className="obs-ptime-note">{playing ? tn.realTime : tn.paused}</span>
          )}
        </span>
        {(phase.kind === "running" || phase.kind === "starting") && (
          <PlayerProgress
            value={s ? s.done / Math.max(1, s.calls) : 0}
            label={s ? `${s.done}/${s.calls}` : `0/${lastCalls.current || "…"}`}
            title={t.run.progress}
          />
        )}
      </Slot>
      <Slot name="win:metrics">
        {s ? (
          <div className="obs-stats">
            <p className="obs-note">{tn.limits}</p>
            <Stat
              label={tn.stats.answered}
              value={`${s.ok}/${total}`}
              hint={tn.stats.verified}
              tone="data"
              bar={s.ok / Math.max(1, total)}
            />
            <Stat label={tn.stats.csHits} value={s.csHits} tone="data" />
            <Stat label={tn.stats.aggregated} value={s.aggregated} tone="interest" />
            <Stat label={tn.stats.upstream} value={s.upstream} hint={tn.stats.upstreamHint} />
            <Stat label={tn.stats.bypass} value={s.bypass} />
            <Stat label={tn.stats.failed} value={s.failed} />
            <Stat label={tn.stats.latency} value={s.ok ? `${Math.round(s.meanMs)} ms` : "—"} />
          </div>
        ) : (
          <Empty>{status}</Empty>
        )}
      </Slot>
      <Slot name="win:compare">
        <Empty>{tn.stats.noCompare}</Empty>
      </Slot>
      <Slot name="win:log">
        {calls.length === 0 ? (
          <Empty>{tn.logEmpty}</Empty>
        ) : (
          <ul className="obs-ndn-log">
            {[...calls].reverse().map((c) => (
              <li key={`${c.agent}-${c.at}`} data-ok={c.ok || undefined}>
                <span className="t-mono text-faint">{c.agent}</span>
                <span className="t-mono">{c.tool}</span>
                <span className="t-mono obs-ndn-log-name" title={c.name}>
                  {c.bypass ? tn.notOnNdn : c.name ? shortName(c.name) : ""}
                </span>
                <span className={c.ok ? "text-data" : c.bypass ? "text-faint" : "text-fg"}>
                  {c.ok ? `${Math.round(c.ms)} ms` : c.bypass ? "—" : (c.error ?? ts.done)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Slot>
    </>
  );
}
