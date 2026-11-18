"use client";

import type { Data, JsonValue, TrustStore } from "@idem/core";
import { MAX_PACKET_SIZE, type TlvNode } from "@idem/ndn";
import { useEffect, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { ndn } from "@/lib/i18n/messages/ndn";
import { hexLines, type NdnExchangeView, type NdnPacketView, ndnExchange, tlvRange } from "@/lib/sandbox/ndn";

/** Props of {@link NdnPacket}: what Live mode already holds for one call (a row). */
export interface NdnPacketProps {
  /** IDEM name of the call (`row.name`); absent for plain calls. */
  name?: string;
  /** Canonical arguments (`row.canonical`). */
  args?: JsonValue;
  /** The verified overlay Data, once it arrived (`row.out?.data`). */
  data?: Data;
  /** The trust store that accepted the producer's manifest (`row.client?.trust`). */
  trust?: TrustStore;
}

type Range = [number, number];

function Verdict({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className="obs-verdict" data-ok={ok || undefined}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

function TlvRows({
  nodes,
  depth,
  kind,
  onRange,
  field,
}: {
  nodes: TlvNode[];
  depth: number;
  kind: "interest" | "data";
  onRange: (r: Range | undefined) => void;
  field: (type: number, length: number) => string;
}) {
  return (
    <>
      {nodes.map((n) => (
        <li key={`${n.offset}-${n.type}`}>
          <div
            tabIndex={0}
            title={field(n.type, n.length)}
            className="flex min-w-0 items-baseline gap-2 rounded-sm px-1 py-px outline-none hover:bg-subtle focus-visible:bg-subtle"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            onPointerEnter={() => onRange(tlvRange(n))}
            onPointerLeave={() => onRange(undefined)}
            onFocus={() => onRange(tlvRange(n))}
            onBlur={() => onRange(undefined)}
          >
            <span className={`shrink-0 ${kind === "interest" ? "text-interest" : "text-data"}`}>
              {n.typeName ?? `TLV ${n.type}`}
            </span>
            <span className="shrink-0 text-faint tabular-nums">{n.length}</span>
            {n.preview !== undefined && n.preview !== "" && (
              <span className="min-w-0 truncate text-muted">{n.preview}</span>
            )}
          </div>
          {n.children && n.children.length > 0 && (
            <ul>
              <TlvRows nodes={n.children} depth={depth + 1} kind={kind} onRange={onRange} field={field} />
            </ul>
          )}
        </li>
      ))}
    </>
  );
}

function HexDump({ pkt, range }: { pkt: NdnPacketView; range: Range | undefined }) {
  const lit = pkt.kind === "interest" ? "bg-interest-soft text-fg" : "bg-data-soft text-fg";
  return (
    <pre className="t-mono m-0 max-h-48 overflow-auto text-[10.5px] leading-[1.55] text-muted">
      {hexLines(pkt.hex).map((line) => (
        <div key={line.offset} className="flex gap-3 whitespace-nowrap">
          <span className="text-faint tabular-nums">{line.offset.toString(16).padStart(4, "0")}</span>
          <span>
            {line.bytes.map((b, i) => {
              const at = line.offset + i;
              const on = range !== undefined && at >= range[0] && at < range[1];
              return (
                <span key={at} className={on ? lit : undefined}>
                  {b}
                  {i < line.bytes.length - 1 ? " " : ""}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </pre>
  );
}

/**
 * The native NDN form of one Live-mode exchange (ADR-026): the NDN Interest and Data that
 * `@idem/ndn` builds from the real overlay packets, as a TLV tree beside a hex dump (pointing at a
 * field lights its bytes), and both signature checks run in the page on the Data's wire bytes.
 * Presentational: it computes everything from its props and keeps no state beyond the view.
 */
export function NdnPacket({ name, args, data, trust }: NdnPacketProps) {
  const t = useMessages(ndn);
  const [view, setView] = useState<NdnExchangeView>();
  const [tab, setTab] = useState<"interest" | "data">("interest");
  const [range, setRange] = useState<Range>();

  useEffect(() => {
    setView(undefined);
    setRange(undefined);
    let live = true;
    void ndnExchange({
      ...(name !== undefined && args !== undefined && { interest: { name, args } }),
      ...(data && { data }),
      ...(trust && { trust }),
    }).then((v) => {
      if (live) setView(v);
    });
    return () => {
      live = false;
    };
  }, [name, args, data, trust]);

  if (!view) return <p className="obs-note">{t.pending}</p>;

  const reason = view.unavailable?.reason;
  const note =
    reason === "private"
      ? t.unavailable.private
      : reason === "plain"
        ? t.unavailable.plain
        : reason === "too-large"
          ? t.unavailable.tooLarge(MAX_PACKET_SIZE)
          : reason === "error"
            ? t.unavailable.error(view.unavailable?.message ?? "")
            : undefined;

  const active = view.data ? tab : "interest";
  const shown = active === "data" ? view.data : view.interest;

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={t.title}>
      <header className="flex flex-col gap-1">
        <h3 className="m-0 text-[12.5px] font-semibold text-fg">{t.title}</h3>
        <p className="obs-note m-0">{t.blurb}</p>
      </header>

      {note && <p className="obs-note m-0">{note}</p>}

      {view.interest && (
        <>
          <div role="tablist" aria-label={t.packet} className="flex gap-1">
            {(["interest", "data"] as const).map((k) => {
              const on = active === k;
              const disabled = k === "data" && !view.data;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  disabled={disabled}
                  onClick={() => {
                    setTab(k);
                    setRange(undefined);
                  }}
                  className={`t-mono rounded-sm border px-2 py-0.5 text-[11.5px] disabled:opacity-40 ${
                    on
                      ? k === "interest"
                        ? "border-interest bg-interest-soft text-interest"
                        : "border-data bg-data-soft text-fg"
                      : "border-line text-muted"
                  }`}
                >
                  {k === "interest" ? t.interest : t.data}
                </button>
              );
            })}
          </div>

          {!view.data && !note && <p className="obs-note m-0">{t.waiting}</p>}

          {shown && (
            <div role="tabpanel" className="flex min-w-0 flex-col gap-3">
              <div className="obs-kv">
                <span className="obs-kv-label">{t.name}</span>
                <p className="t-mono m-0 break-all text-[11.5px] leading-relaxed text-fg">{shown.name}</p>
                <p className="m-0 text-[11.5px] text-faint tabular-nums">
                  {t.size(shown.wire.length, shown.overlayBytes)}
                </p>
              </div>

              <div className="obs-kv">
                <span className="obs-kv-label">{t.tree}</span>
                <ul className="t-mono m-0 list-none p-0 text-[11px] leading-relaxed">
                  <TlvRows
                    nodes={shown.tree}
                    depth={0}
                    kind={shown.kind}
                    onRange={setRange}
                    field={t.field}
                  />
                </ul>
                <p className="obs-note m-0">{t.hoverHint}</p>
              </div>

              <div className="obs-kv">
                <span className="obs-kv-label">{t.bytes}</span>
                <HexDump pkt={shown} range={range} />
              </div>

              {shown.kind === "data" && view.verify && (
                <div className="obs-kv">
                  <span className="obs-kv-label">{t.verify.title}</span>
                  <dl className="obs-parts">
                    <dt>{t.verify.outer}</dt>
                    <dd className="flex flex-col gap-0.5">
                      <Verdict ok={view.verify.outer.ok}>
                        {view.verify.outer.ok ? t.verify.ok : t.verify.bad}
                      </Verdict>
                      <span className="text-faint">{t.verify.outerNote}</span>
                      {view.translatorKeyLocator && (
                        <span className="break-all text-muted">{view.translatorKeyLocator}</span>
                      )}
                    </dd>
                    <dt>{t.verify.inner}</dt>
                    <dd className="flex flex-col gap-0.5">
                      <Verdict ok={view.verify.inner.ok}>
                        {view.verify.inner.ok ? t.verify.ok : t.verify.bad}
                      </Verdict>
                      <span className="text-faint">{t.verify.innerNote}</span>
                      {!view.verify.inner.ok && (
                        <span className="text-muted">{view.verify.inner.reason}</span>
                      )}
                    </dd>
                  </dl>
                  <p className="obs-note m-0">{t.translatorNote}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
