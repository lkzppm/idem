"use client";

import { useEffect, useId, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { editor } from "@/lib/i18n/messages/editor";
import {
  type AgentConfig,
  isProducerName,
  linkProblem,
  type NetLink,
  type NetNode,
  type Network,
  producerNodes,
  reachableProducers,
  setLink,
  setNodeConfig,
  TOOL_IDS,
  TOOLS,
  type ToolId,
} from "@/lib/sandbox/network";
import type { EditorSelection } from "../stage-canvas";
import { aboutLabel, Button, fmtBytes, InfoTip, Label, Slider } from "../ui";

type Edit = (next: Network, coalesce?: string) => void;
type T = (typeof editor)["en"];

/**
 * The selected node's or link's settings (the body of the selection card), every field with its info tip. Changes apply at once
 * (the run restarts, debounced); a slider drag is one undo step.
 */
export function Properties({
  net,
  sel,
  edit,
  onSelect,
  onDelete,
  onConnect,
}: {
  net: Network;
  sel: EditorSelection | undefined;
  edit: Edit;
  onSelect: (s: EditorSelection | undefined) => void;
  onDelete: () => void;
  onConnect: (a: string, b: string) => void;
}) {
  const t = useMessages(editor);
  const p = t.props;
  if (!sel) return null;
  if (sel.kind === "link") {
    const l = net.links.find((x) => x.id === sel.id);
    return l ? <LinkProps l={l} net={net} edit={edit} t={t} onDelete={onDelete} /> : null;
  }
  const n = net.nodes.find((x) => x.id === sel.id);
  if (!n) return null;
  return (
    <div className="obs-props">
      {n.kind === "agent" && <AgentProps n={n} net={net} edit={edit} t={t} />}
      {n.kind === "forwarder" && (
        <Slider
          label={p.csSize}
          tip={p.tips.csSize}
          value={Math.log2(n.config.csKiB)}
          min={4}
          max={16}
          step={1}
          format={() => fmtBytes(n.config.csKiB * 1024)}
          onChange={(v) => edit(setNodeConfig<"forwarder">(net, n.id, { csKiB: 2 ** v }), `${n.id}.cs`)}
        />
      )}
      {n.kind === "producer" && <ProducerProps n={n} net={net} edit={edit} t={t} />}
      <Connect n={n} net={net} t={t} onConnect={onConnect} onSelect={onSelect} />
      <Button variant="ghost" onClick={onDelete} kbd="Del" className="obs-props-delete">
        {p.delete}
      </Button>
    </div>
  );
}

function AgentProps({
  n,
  net,
  edit,
  t,
}: {
  n: Extract<NetNode, { kind: "agent" }>;
  net: Network;
  edit: Edit;
  t: T;
}) {
  const p = t.props;
  const c = n.config;
  const set = (patch: Partial<AgentConfig>, key: string) =>
    edit(setNodeConfig<"agent">(net, n.id, { ...c, ...patch }), `${n.id}.${key}`);
  const reach = reachableProducers(net, n.id);
  const producers = producerNodes(net);
  const nameOf = new Map(producers.map((x) => [x.id, x.config.name]));
  const has = (producer: string, tool: ToolId) =>
    c.tools.find((x) => x.producer === producer && x.tool === tool);
  const usesFetch = c.tools.some((x) => x.tool === "fetch_page");
  // Entries that point at a producer it cannot reach, or a tool that producer stopped serving.
  const stale = c.tools.filter((x) => {
    const prod = producers.find((q) => q.id === x.producer);
    return !reach.includes(x.producer) || !prod?.config.tools.some((s) => s.tool === x.tool);
  });
  return (
    <>
      <Slider
        label={p.calls}
        tip={p.tips.calls}
        value={c.calls}
        min={1}
        max={40}
        onChange={(v) => set({ calls: v }, "calls")}
      />
      <Slider
        label={p.think}
        tip={p.tips.think}
        value={c.thinkMs}
        min={20}
        max={3000}
        step={20}
        format={(v) => `${v} ms`}
        onChange={(v) => set({ thinkMs: v }, "think")}
      />
      {usesFetch && (
        <>
          <Slider
            label={p.overlap}
            tip={p.tips.overlap}
            value={Math.round(c.overlap * 100)}
            min={0}
            max={100}
            format={(v) => `${v}%`}
            onChange={(v) => set({ overlap: v / 100 }, "overlap")}
          />
          <Slider
            label={p.zipf}
            tip={p.tips.zipf}
            value={c.zipf}
            min={0}
            max={2}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => set({ zipf: v }, "zipf")}
          />
        </>
      )}
      <div className="obs-field">
        <Label tip={p.tips.tools}>{p.tools}</Label>
        {reach.length === 0 ? (
          <p className="obs-note">{p.noReach}</p>
        ) : (
          <ul className="obs-toollist">
            {reach.map((pid) => {
              const prod = producers.find((q) => q.id === pid);
              if (!prod) return null;
              return (
                <li key={pid} className="obs-toolgroup">
                  <span className="obs-toolgroup-name t-mono">{prod.config.name}</span>
                  {prod.config.tools.map(({ tool }) => {
                    const entry = has(pid, tool);
                    return (
                      <div key={tool} className="obs-toolrow" data-on={entry ? "" : undefined}>
                        <label className="obs-toolrow-check">
                          <input
                            type="checkbox"
                            checked={!!entry}
                            onChange={(e) =>
                              set(
                                {
                                  tools: e.target.checked
                                    ? [...c.tools, { producer: pid, tool, weight: 1 }]
                                    : c.tools.filter((x) => !(x.producer === pid && x.tool === tool)),
                                },
                                `tools.${pid}.${tool}`,
                              )
                            }
                          />
                          <span className="t-mono">{tool}</span>
                          {TOOLS[tool].scope !== "public" && (
                            <span className="obs-tag">
                              {TOOLS[tool].scope === "private" ? p.private : p.notCacheable}
                            </span>
                          )}
                        </label>
                        {entry && (
                          <input
                            type="range"
                            className="range obs-toolrow-weight"
                            aria-label={`${p.weight}: ${tool}`}
                            title={`${p.weight} ${entry.weight}`}
                            min={1}
                            max={10}
                            value={entry.weight}
                            onChange={(e) =>
                              set(
                                {
                                  tools: c.tools.map((x) =>
                                    x === entry ? { ...x, weight: Number(e.target.value) } : x,
                                  ),
                                },
                                `weight.${pid}.${tool}`,
                              )
                            }
                          />
                        )}
                        {entry && <span className="obs-toolrow-w t-mono">{entry.weight}</span>}
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
        {stale.length > 0 && (
          <ul className="obs-issues">
            {stale.map((x) => {
              const name = nameOf.get(x.producer) ?? x.producer;
              return (
                <li key={`${x.producer}.${x.tool}`}>
                  <span>
                    <span className="t-mono">{x.tool}</span> ·{" "}
                    {reach.includes(x.producer) ? p.notServed(name) : p.unreachable(name)}
                  </span>
                  <button
                    type="button"
                    className="obs-link-btn"
                    onClick={() => set({ tools: c.tools.filter((y) => y !== x) }, "tools-stale")}
                  >
                    {p.removeTool(x.tool)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function ProducerProps({
  n,
  net,
  edit,
  t,
}: {
  n: Extract<NetNode, { kind: "producer" }>;
  net: Network;
  edit: Edit;
  t: T;
}) {
  const p = t.props;
  const c = n.config;
  const id = useId();
  const [draft, setDraft] = useState(c.name);
  useEffect(() => setDraft(c.name), [c.name]);
  const taken = producerNodes(net).some((x) => x.id !== n.id && x.config.name === draft);
  const valid = isProducerName(draft) && !taken;
  const serves = (tool: ToolId) => c.tools.find((x) => x.tool === tool);
  const setTools = (tools: typeof c.tools, key: string) =>
    edit(setNodeConfig<"producer">(net, n.id, { ...c, tools }), `${n.id}.${key}`);
  return (
    <>
      <div className="obs-field">
        <Label htmlFor={`${id}-name`} tip={p.tips.name}>
          {p.name}
        </Label>
        <input
          id={`${id}-name`}
          className="obs-input t-mono"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!valid}
          aria-describedby={valid ? undefined : `${id}-name-err`}
          onChange={(e) => {
            const v = e.target.value.trim().toLowerCase();
            setDraft(v);
            const ok =
              isProducerName(v) && !producerNodes(net).some((x) => x.id !== n.id && x.config.name === v);
            if (ok) edit(setNodeConfig<"producer">(net, n.id, { ...c, name: v }), `${n.id}.name`);
          }}
          onBlur={() => setDraft(c.name)}
        />
        {!valid && (
          <p id={`${id}-name-err`} className="obs-note obs-note-warn">
            {p.nameInvalid}
          </p>
        )}
      </div>
      <div className="obs-field">
        <Label tip={p.tips.serves}>{p.serves}</Label>
        <ul className="obs-toollist">
          {TOOL_IDS.map((tool) => {
            const s = serves(tool);
            const info = TOOLS[tool];
            return (
              <li key={tool} className="obs-toolrow" data-on={s ? "" : undefined}>
                <label className="obs-toolrow-check">
                  <input
                    type="checkbox"
                    checked={!!s}
                    onChange={(e) =>
                      setTools(
                        e.target.checked
                          ? TOOL_IDS.flatMap((x) =>
                              x === tool ? [{ tool, ttl: info.ttl }] : c.tools.filter((y) => y.tool === x),
                            )
                          : c.tools.filter((y) => y.tool !== tool),
                        `serves.${tool}`,
                      )
                    }
                  />
                  <span className="t-mono">{tool}</span>
                  {info.scope === "private" && <span className="obs-tag">{p.private}</span>}
                </label>
                {s && info.scope === "none" && (
                  <span className="obs-toolrow-ttl text-faint">{p.notCacheable}</span>
                )}
                {s && info.scope !== "none" && (
                  <span className="obs-toolrow-ttl">
                    <input
                      type="number"
                      className="obs-input obs-input-sm t-mono"
                      aria-label={`${p.ttl}: ${tool}`}
                      title={p.ttl}
                      min={1}
                      max={3600}
                      value={s.ttl}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(3600, Math.round(Number(e.target.value) || 1)));
                        setTools(
                          c.tools.map((y) => (y.tool === tool ? { ...y, ttl: v } : y)),
                          `ttl.${tool}`,
                        );
                      }}
                    />
                    <span className="text-faint">s</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <Slider
        label={p.service}
        tip={p.tips.service}
        value={c.serviceMs}
        min={5}
        max={2000}
        step={5}
        format={(v) => `${v} ms`}
        onChange={(v) =>
          edit(setNodeConfig<"producer">(net, n.id, { ...c, serviceMs: v }), `${n.id}.service`)
        }
      />
    </>
  );
}

function LinkProps({
  l,
  net,
  edit,
  t,
  onDelete,
}: {
  l: NetLink;
  net: Network;
  edit: Edit;
  t: T;
  onDelete: () => void;
}) {
  const p = t.props;
  return (
    <div className="obs-props">
      <Slider
        label={p.latency}
        tip={p.tips.latency}
        value={l.latencyMs}
        min={1}
        max={500}
        format={(v) => `${v} ms`}
        onChange={(v) => edit(setLink(net, l.id, { latencyMs: v }), `${l.id}.latency`)}
      />
      <Slider
        label={p.loss}
        tip={p.tips.loss}
        value={l.lossPct}
        min={0}
        max={30}
        step={0.5}
        format={(v) => `${v}%`}
        onChange={(v) => edit(setLink(net, l.id, { lossPct: v }), `${l.id}.loss`)}
      />
      <Button variant="ghost" onClick={onDelete} kbd="Del" className="obs-props-delete">
        {p.delete}
      </Button>
    </div>
  );
}

/** "Connect to…": the keyboard way to draw a link from this node. */
function Connect({
  n,
  net,
  t,
  onConnect,
  onSelect,
}: {
  n: NetNode;
  net: Network;
  t: T;
  onConnect: (a: string, b: string) => void;
  onSelect: (s: EditorSelection | undefined) => void;
}) {
  const p = t.props;
  const id = useId();
  const targets = net.nodes.filter((m) => m.id !== n.id && !linkProblem(net, n.id, m.id));
  return (
    <div className="obs-field">
      <div className="obs-label-row">
        <label htmlFor={id} className="obs-label">
          {p.connect}
        </label>
        <InfoTip label={aboutLabel(p.connect)}>{p.tips.connect}</InfoTip>
      </div>
      <select
        id={id}
        className="obs-select"
        value=""
        disabled={targets.length === 0}
        onChange={(e) => {
          if (!e.target.value) return;
          onConnect(n.id, e.target.value);
          onSelect({ kind: "node", id: n.id });
        }}
      >
        <option value="">{targets.length ? "—" : p.connectNone}</option>
        {targets.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
            {m.kind === "producer" ? ` (${m.config.name})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
