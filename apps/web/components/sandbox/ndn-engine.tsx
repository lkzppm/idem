"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { editor as editorMessages } from "@/lib/i18n/messages/editor";
import { sandbox } from "@/lib/i18n/messages/sandbox";
import { browserYanfd, type NdnCall, NdnNetwork, type NdnStats } from "@/lib/sandbox/ndn-net";
import type { Network } from "@/lib/sandbox/network";
import { runSignature } from "@/lib/sandbox/run";
import { TopologyScene } from "@/lib/sandbox/scene";
import { RestartIcon } from "./icons";
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

const mb = (n: number) => `${fixed(n / 1_000_000, 1)} MB`;

/**
 * The editor's NDN engine on the stage: the network runs on YaNFD routers compiled to WebAssembly,
 * one per forwarder node, in this tab and in real time (`lib/sandbox/ndn-net.ts`). It owns the
 * stage, the status cluster, and the log and metrics windows while it runs.
 */
export function NdnEngine({
  net,
  editor,
  onBackend,
}: {
  net: Network;
  editor: StageEditor;
  onBackend: (b: "webgpu" | "canvas2d") => void;
}) {
  const t = useMessages(editorMessages);
  const tn = t.ndn;
  const ts = useMessages(sandbox).swarm;
  const ws = useWorkspace();
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

  // Build and start the network; rebuild when what it does changes (not when a node moves).
  useEffect(() => {
    void sig;
    void runId;
    const n = netRef.current;
    scene.setTopology(n, 0);
    setNodes([...scene.nodes.values()]);
    log.current = [];
    setCalls([]);
    setStats(undefined);
    if (typeof WebAssembly === "undefined") {
      setPhase({ kind: "unsupported" });
      return;
    }
    let cancelled = false;
    let running: NdnNetwork | undefined;
    const { factory, ready } = browserYanfd("/ndn/", (loaded, total) => {
      if (!cancelled) setPhase({ kind: "loading", loaded, total });
    });
    void (async () => {
      try {
        await ready;
        if (cancelled) return;
        setPhase({ kind: "starting" });
        const made = await NdnNetwork.create(n, factory, {
          packet: (p) => scene.addPacket({ ...p, kind: p.kind }),
          flash: (node, kind) => scene.flash(node, kind),
          call: (c) => {
            log.current.push(c);
            if (log.current.length > LOG_CAP) log.current.splice(0, log.current.length - LOG_CAP);
          },
        });
        if (cancelled) {
          made.stop();
          return;
        }
        running = made;
        made.start();
        setPhase({ kind: "running", routers: n.nodes.filter((x) => x.kind === "forwarder").length });
      } catch (e) {
        if (!cancelled) setPhase({ kind: "failed", why: e instanceof Error ? e.message : String(e) });
      }
    })();
    const id = setInterval(() => {
      if (!running) return;
      const s = running.stats();
      setStats(s);
      for (const [fid, f] of Object.entries(s.forwarders))
        scene.setState(fid, { pit: f.pit, cs: f.csHits, fresh: 1 });
      setCalls([...log.current]);
    }, 250);
    return () => {
      cancelled = true;
      clearInterval(id);
      running?.stop();
    };
  }, [sig, runId, scene]);

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
              title: tn.title,
              note: `${tn.note} · ${tn.realTime}`,
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
          onBackend={onBackend}
          editor={editor}
        />
      </Slot>
      <Slot name="status">
        <button
          type="button"
          className="obs-round-btn"
          aria-label={tn.restart}
          title={tn.restart}
          onClick={() => setRunId((r) => r + 1)}
        >
          <RestartIcon />
        </button>
        <span
          className="obs-status"
          data-state={phase.kind === "running" ? (s && s.done >= s.calls ? "done" : "ready") : "paused"}
          role="status"
        >
          <span className="text-fg">{status}</span>
          {s && phase.kind === "running" && (
            <span className="t-mono tabular-nums text-faint">
              {s.done}/{s.calls}
            </span>
          )}
        </span>
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
