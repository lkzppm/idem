"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "@/lib/i18n/client";
import { editor } from "@/lib/i18n/messages/editor";
import { EXAMPLE_IDS, type ExampleId, example } from "@/lib/sandbox/examples";
import type { Network } from "@/lib/sandbox/network";

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

/** The cards to start from: the saved network (if any), then every example. */
function ExampleCards({
  current,
  saved,
  onPick,
  onResume,
}: {
  current?: string;
  saved?: Network;
  onPick: (id: ExampleId) => void;
  onResume?: () => void;
}) {
  const t = useMessages(editor);
  return (
    <ul className="obs-picks">
      {saved && onResume && (
        <li>
          <button type="button" className="obs-pick" data-resume="" onClick={onResume}>
            <NetworkThumb net={saved} />
            <span className="obs-pick-name">{t.picker.resume}</span>
            <span className="obs-pick-blurb">
              {t.picker.resumeBlurb(
                (t.example as Record<string, { name: string }>)[saved.from]?.name ?? saved.from,
                saved.nodes.length,
              )}
            </span>
          </button>
        </li>
      )}
      {EXAMPLE_IDS.map((id) => {
        const net = example(id);
        const e = t.example[id];
        return (
          <li key={id}>
            <button
              type="button"
              className="obs-pick"
              data-current={current === id ? "" : undefined}
              onClick={() => onPick(id)}
            >
              <NetworkThumb net={net ?? LIVE_PREVIEW} />
              <span className="obs-pick-name">
                {e.name}
                {current === id && <span className="obs-pick-tag">{t.picker.current}</span>}
                {id === "live" && <span className="obs-pick-tag">{t.picker.locked}</span>}
              </span>
              <span className="obs-pick-blurb">{e.blurb}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The start screen: what the sandbox shows when it opens with nothing to load (no shared link). The
 * visitor picks an example, a blank canvas, Live, or the network this browser saved last.
 */
export function StartScreen({
  saved,
  onPick,
  onResume,
}: {
  saved?: Network;
  onPick: (id: ExampleId) => void;
  onResume: () => void;
}) {
  const t = useMessages(editor);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(".obs-pick")?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={box} className="obs-start">
      <div className="obs-start-inner">
        <h1 className="obs-start-title">{t.picker.startTitle}</h1>
        <p className="obs-modal-intro">{t.picker.intro}</p>
        <ExampleCards saved={saved} onPick={onPick} onResume={onResume} />
      </div>
    </div>
  );
}

/** The example picker in the middle of a session: a dialog over the stage. Escape or a click outside closes it. */
export function ExamplePicker({
  open,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  /** The example the open network came from (`live` for Live). */
  current: string | undefined;
  onPick: (id: ExampleId) => void;
  onClose: () => void;
}) {
  const t = useMessages(editor);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const first =
      box.current?.querySelector<HTMLButtonElement>("button[data-current]") ??
      box.current?.querySelector<HTMLButtonElement>(".obs-pick");
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && box.current) {
        // Keep focus inside the dialog.
        const f = [...box.current.querySelectorAll<HTMLElement>("button")];
        const i = f.indexOf(document.activeElement as HTMLElement);
        const j = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
        f[j]?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="obs-modal-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={box} className="obs-modal" role="dialog" aria-modal="true" aria-labelledby="obs-pick-title">
        <div className="obs-modal-head">
          <div>
            <h2 id="obs-pick-title" className="obs-modal-title">
              {t.picker.title}
            </h2>
            <p className="obs-modal-intro">{t.picker.intro}</p>
          </div>
          <button
            type="button"
            className="obs-win-btn"
            aria-label={t.picker.close}
            title={t.picker.close}
            onClick={onClose}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <ExampleCards current={current} onPick={onPick} />
      </div>
    </div>,
    document.body,
  );
}
