"use client";

import { type CSSProperties, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { editor } from "@/lib/i18n/messages/editor";
import { EXAMPLE_IDS, type ExampleId, example } from "@/lib/sandbox/examples";
import type { Network } from "@/lib/sandbox/network";
import { ArrowIcon, PlusIcon } from "../icons";

/** The Live example is not a network; its card shows the deployed path instead. */
const LIVE_PREVIEW: Pick<Network, "nodes" | "links"> = {
  nodes: [
    {
      id: "you",
      kind: "agent",
      x: -200,
      y: 0,
      config: { tools: [], calls: 0, thinkMs: 0, overlap: 0, zipf: 0 },
    },
    { id: "edge", kind: "forwarder", x: 0, y: 0, config: { csKiB: 0 } },
    { id: "producer", kind: "producer", x: 200, y: 0, config: { name: "x", tools: [], serviceMs: 0 } },
  ],
  links: [
    { id: "a", a: "you", b: "edge", latencyMs: 0, lossPct: 0 },
    { id: "b", a: "edge", b: "producer", latencyMs: 0, lossPct: 0 },
  ],
};

/** A small drawing of a network: dashed agent links, solid core links, the node shapes of the stage. */
export function NetworkThumb({ net }: { net: Pick<Network, "nodes" | "links"> }) {
  const W = 200;
  const H = 110;
  const pad = 16;
  const xs = net.nodes.map((n) => n.x);
  const ys = net.nodes.map((n) => n.y);
  const [x0, x1, y0, y1] = xs.length
    ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    : [0, 0, 0, 0];
  const k = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, y1 - y0), 0.5);
  const at = (x: number, y: number): [number, number] => [
    W / 2 + (x - (x0 + x1) / 2) * k,
    H / 2 + (y - (y0 + y1) / 2) * k,
  ];
  const pos = new Map(net.nodes.map((n) => [n.id, at(n.x, n.y)]));
  const kind = new Map(net.nodes.map((n) => [n.id, n.kind]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="obs-thumb" aria-hidden="true">
      {net.links.map((l) => {
        const a = pos.get(l.a);
        const b = pos.get(l.b);
        if (!a || !b) return null;
        const agent = kind.get(l.a) === "agent" || kind.get(l.b) === "agent";
        return (
          <line
            key={l.id}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            className={agent ? "obs-thumb-link obs-thumb-link-agent" : "obs-thumb-link"}
          />
        );
      })}
      {net.nodes.map((n) => {
        const [x, y] = pos.get(n.id) as [number, number];
        if (n.kind === "agent")
          return <circle key={n.id} cx={x} cy={y} r={3.4} className="obs-thumb-agent" />;
        if (n.kind === "forwarder")
          return (
            <rect key={n.id} x={x - 6} y={y - 6} width={12} height={12} rx={3} className="obs-thumb-fwd" />
          );
        return (
          <g key={n.id}>
            <rect x={x - 7} y={y - 7} width={14} height={14} rx={3.4} className="obs-thumb-prod" />
            <rect x={x - 3} y={y - 3} width={6} height={6} rx={1.4} className="obs-thumb-prod-core" />
          </g>
        );
      })}
      {net.nodes.length === 0 && (
        <path d={`M${W / 2 - 10} ${H / 2}h20M${W / 2} ${H / 2 - 10}v20`} className="obs-thumb-plus" />
      )}
    </svg>
  );
}

/**
 * The start screen (ADR-029): what the sandbox shows when nothing is loaded. On the left, a blank
 * canvas (the big plus) and the network this browser saved last; on the right, the examples in a
 * column. Picking one plays the leave animation while the workspace comes in; the sidebar's back
 * button returns here (no network is ever loaded over another).
 */
export function StartScreen({
  saved,
  leaving,
  onPick,
  onResume,
}: {
  saved?: Network;
  /** The visitor picked: the screen is animating out. */
  leaving?: boolean;
  onPick: (id: ExampleId) => void;
  onResume: () => void;
}) {
  const t = useMessages(editor);
  const [picked, setPicked] = useState<string>();
  const examples = EXAMPLE_IDS.filter((id) => id !== "blank");
  const pick = (id: ExampleId) => {
    setPicked(id);
    onPick(id);
  };
  const savedFrom = saved
    ? ((t.example as Record<string, { name: string }>)[saved.from]?.name ?? saved.from)
    : "";
  return (
    <div className="obs-start" data-leaving={leaving || undefined} inert={leaving || undefined}>
      <div className="obs-start-inner">
        <header className="obs-start-head">
          <h1 className="obs-start-title">{t.picker.startTitle}</h1>
          <p className="obs-start-intro">{t.picker.intro}</p>
        </header>
        <div className="obs-start-grid">
          <div className="obs-start-new">
            <button
              type="button"
              className="obs-new"
              data-picked={picked === "blank" || undefined}
              onClick={() => pick("blank")}
            >
              <span className="obs-new-plus" aria-hidden="true">
                <PlusIcon size={34} />
              </span>
              <span className="obs-new-name">{t.example.blank.name}</span>
              <span className="obs-new-blurb">{t.example.blank.blurb}</span>
            </button>
            {saved && (
              <button
                type="button"
                className="obs-row obs-resume"
                data-picked={picked === "resume" || undefined}
                onClick={() => {
                  setPicked("resume");
                  onResume();
                }}
              >
                <NetworkThumb net={saved} />
                <span className="obs-row-text">
                  <span className="obs-row-name">{t.picker.resume}</span>
                  <span className="obs-row-blurb">{t.picker.resumeBlurb(savedFrom, saved.nodes.length)}</span>
                </span>
                <span className="obs-row-go" aria-hidden="true">
                  <ArrowIcon />
                </span>
              </button>
            )}
          </div>
          <section className="obs-start-examples" aria-labelledby="obs-examples-title">
            <h2 id="obs-examples-title" className="obs-start-sub">
              {t.examples}
            </h2>
            <ul className="obs-rows">
              {examples.map((id, i) => {
                const e = t.example[id];
                return (
                  <li key={id} style={{ "--i": i } as CSSProperties}>
                    <button
                      type="button"
                      className="obs-row"
                      data-picked={picked === id || undefined}
                      onClick={() => pick(id)}
                    >
                      <NetworkThumb net={example(id) ?? LIVE_PREVIEW} />
                      <span className="obs-row-text">
                        <span className="obs-row-name">
                          {e.name}
                          {id === "live" && <span className="obs-row-tag">{t.picker.locked}</span>}
                        </span>
                        <span className="obs-row-blurb">{e.blurb}</span>
                      </span>
                      <span className="obs-row-go" aria-hidden="true">
                        <ArrowIcon />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
