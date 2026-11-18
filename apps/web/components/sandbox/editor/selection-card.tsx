"use client";

import { useMessages } from "@/lib/i18n/client";
import { editor } from "@/lib/i18n/messages/editor";
import type { Network } from "@/lib/sandbox/network";
import { AsideCard } from "../aside-card";
import type { EditorSelection } from "../stage-canvas";
import { NodeGlyph } from "./glyph";
import { Properties } from "./properties";

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
  return (
    <AsideCard
      item={sel}
      keyOf={(s) => `${s.kind}:${s.id}`}
      closeLabel={t.props.close}
      onClose={() => onSelect(undefined)}
      face={(s) => {
        let kind: "agent" | "forwarder" | "producer" | "link";
        let title: string;
        let sub: string;
        if (s.kind === "link") {
          const l = net.links.find((x) => x.id === s.id);
          if (!l) return null;
          kind = "link";
          title = `${l.a} ↔ ${l.b}`;
          sub = t.props.kinds.link;
        } else {
          const n = net.nodes.find((x) => x.id === s.id);
          if (!n) return null;
          kind = n.kind;
          title = n.kind === "producer" ? n.config.name : n.id;
          sub = n.kind === "producer" ? `${t.props.kinds.producer} · ${n.id}` : t.props.kinds[n.kind];
        }
        return {
          glyph: <NodeGlyph kind={kind} size={16} />,
          title,
          sub,
          body: (
            <Properties
              net={net}
              sel={s}
              edit={edit}
              onSelect={onSelect}
              onDelete={onDelete}
              onConnect={onConnect}
            />
          ),
        };
      }}
    />
  );
}
