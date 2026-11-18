"use client";

import { useEffect, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { editor } from "@/lib/i18n/messages/editor";
import type { Network } from "@/lib/sandbox/network";
import { CloseIcon } from "../icons";
import type { EditorSelection } from "../stage-canvas";
import { NodeGlyph } from "./glyph";
import { Properties } from "./properties";

/** How long the card takes to leave (ms). */
const LEAVE_MS = 170;

/**
 * The selected node's or link's card (ADR-029): it pops in on the right of the stage when something
 * is selected, titled with its name, and holds its settings; it leaves when the selection is
 * cleared (Escape, a click on empty canvas, its close button).
 */
export function SelectionCard({
  net,
  sel,
  edit,
  onSelect,
  onDelete,
  onConnect,
}: {
  net: Network;
  sel: EditorSelection | undefined;
  edit: (next: Network, coalesce?: string) => void;
  onSelect: (s: EditorSelection | undefined) => void;
  onDelete: () => void;
  onConnect: (a: string, b: string) => void;
}) {
  const t = useMessages(editor);
  // The selection drawn: the current one, or the last one while the card leaves.
  const [shown, setShown] = useState(sel);
  const [leaving, setLeaving] = useState(false);
  const selKey = sel ? `${sel.kind}:${sel.id}` : "";

  useEffect(() => {
    if (sel) {
      setShown(sel);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const id = setTimeout(() => {
      setShown(undefined);
      setLeaving(false);
    }, LEAVE_MS);
    return () => clearTimeout(id);
    // `selKey` identifies the selection.
  }, [selKey]);

  if (!shown) return null;
  let kind: "agent" | "forwarder" | "producer" | "link";
  let title: string;
  let sub: string;
  if (shown.kind === "link") {
    const l = net.links.find((x) => x.id === shown.id);
    if (!l) return null;
    kind = "link";
    title = `${l.a} ↔ ${l.b}`;
    sub = t.props.kinds.link;
  } else {
    const n = net.nodes.find((x) => x.id === shown.id);
    if (!n) return null;
    kind = n.kind;
    title = n.kind === "producer" ? n.config.name : n.id;
    sub = n.kind === "producer" ? `${t.props.kinds.producer} · ${n.id}` : t.props.kinds[n.kind];
  }
  return (
    <section className="obs-card" data-leaving={leaving || undefined} aria-label={`${sub}: ${title}`}>
      <header className="obs-card-head">
        <span className="obs-card-glyph">
          <NodeGlyph kind={kind} size={16} />
        </span>
        <span className="obs-card-titles">
          <h2 className="obs-card-title">{title}</h2>
          <span className="obs-card-kind">{sub}</span>
        </span>
        <button
          type="button"
          className="obs-icon-btn obs-card-close"
          aria-label={t.props.close}
          title={`${t.props.close} (Esc)`}
          onClick={() => onSelect(undefined)}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="obs-card-body" key={`${shown.kind}:${shown.id}`}>
        <Properties
          net={net}
          sel={shown}
          edit={edit}
          onSelect={onSelect}
          onDelete={onDelete}
          onConnect={onConnect}
        />
      </div>
    </section>
  );
}
