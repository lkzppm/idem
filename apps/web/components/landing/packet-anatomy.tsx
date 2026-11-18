"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { landing } from "@/lib/i18n/messages/landing";
import { samplePackets } from "@/lib/idem-demo";
import { Refresh } from "./icons";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Every leaf of a JSON value by its path ("meta.scope"), as its JSON text. */
function leaves(v: Json, path = "", out = new Map<string, string>()): Map<string, string> {
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Array.isArray(v) ? v.entries() : Object.entries(v)) {
      leaves(x as Json, path ? `${path}.${k}` : String(k), out);
    }
  } else out.set(path, JSON.stringify(v));
  return out;
}

/** The leaves that differ between two values (an empty set when there is no previous value). */
function diff(prev: Json | undefined, next: Json): Set<string> {
  if (prev === undefined) return new Set();
  const a = leaves(prev);
  const out = new Set<string>();
  for (const [k, v] of leaves(next)) if (a.get(k) !== v) out.add(k);
  return out;
}

function JsonView({
  value,
  indent,
  path,
  marks,
}: {
  value: Json;
  indent: number;
  path: string;
  marks: { changed: Set<string>; kept: Set<string> };
}): ReactNode {
  const pad = "  ".repeat(indent);
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    const cls = marks.changed.has(path) ? "json-new" : marks.kept.has(path) ? "json-kept" : "";
    return <span className={`${typeof value === "string" ? "text-fg" : "text-muted"} ${cls}`}>{s}</span>;
  }
  const entries: [string, Json][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <>
      {open}
      {entries.map(([k, v], i) => (
        <span key={k}>
          {"\n"}
          {pad}
          {"  "}
          {!Array.isArray(value) && (
            <>
              <span className="text-faint">{JSON.stringify(k)}</span>
              {": "}
            </>
          )}
          <JsonView value={v} indent={indent + 1} path={path ? `${path}.${k}` : k} marks={marks} />
          {i < entries.length - 1 ? "," : ""}
        </span>
      ))}
      {"\n"}
      {pad}
      {close}
    </>
  );
}

function Packet({
  kind,
  title,
  value,
  prev,
  version,
  notes,
  signed,
  legend,
}: {
  kind: "interest" | "data";
  title: string;
  value: Json | undefined;
  prev: Json | undefined;
  version: number;
  notes: [string, string][];
  signed: string[];
  legend: ReactNode;
}) {
  const t = useMessages(landing).live;
  const [hot, setHot] = useState<string>();
  const accent = kind === "interest" ? "bg-interest" : "bg-data";
  const text = kind === "interest" ? "text-interest" : "text-data";
  const changed = value ? diff(prev, value) : new Set<string>();
  const kept = prev !== undefined ? new Set(["name"]) : new Set<string>();
  const entries = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
  return (
    <div className="fig-card flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <span aria-hidden="true" className={`h-2.5 w-5 rounded-[5px] ${accent}`} />
        <span className={`text-sm font-semibold ${text}`}>{title}</span>
      </div>
      <pre
        key={version}
        className="t-mono min-h-48 overflow-x-auto px-3 py-4 text-[11.5px] leading-[1.65] text-muted [overflow-wrap:anywhere] whitespace-pre-wrap"
      >
        {value === undefined ? (
          <span className="px-2 text-faint">{t.signing}</span>
        ) : (
          <>
            <span className="px-2">{"{"}</span>
            {entries.map(([k, v], i) => (
              <span
                key={k}
                onPointerEnter={() => setHot(k)}
                onPointerLeave={() => setHot(undefined)}
                className={`jf ${signed.includes(k) ? "jf-signed" : ""} ${k === "name" ? "jf-name" : ""} ${hot === k ? "is-hot" : ""}`}
              >
                {"  "}
                <span className="text-faint">{JSON.stringify(k)}</span>
                {": "}
                <JsonView value={v} indent={1} path={k} marks={{ changed, kept }} />
                {i < entries.length - 1 ? "," : ""}
              </span>
            ))}
            <span className="px-2">{"}"}</span>
          </>
        )}
      </pre>
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-3 text-[12px] text-faint">{legend}</p>
      <dl className="mt-auto grid gap-1 border-t border-line px-3 py-3 text-[13px]">
        {notes.map(([k, v]) => (
          <div
            key={k}
            onPointerEnter={() => setHot(k)}
            onPointerLeave={() => setHot(undefined)}
            className={`note grid grid-cols-[6.5rem_1fr] gap-3 rounded-md px-2 py-1 ${hot === k ? "is-hot" : ""}`}
          >
            <dt className="t-mono text-xs text-fg">{k}</dt>
            <dd className="text-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A real Interest and a real signed Data, produced in the browser with an ephemeral key. The Data's
 * signed bytes (name and meta) are marked; hovering a field or its note lights the other. "Sign
 * again" makes a new key and new packets: what changed flashes yellow, the name (which does not
 * change) flashes blue.
 */
export function PacketAnatomy() {
  const t = useMessages(landing).live;
  // The packets on show and the ones they replaced (for the flash), swapped in one update.
  const [packets, setPackets] = useState<{
    interest: Json;
    data: Json;
    prev?: { interest: Json; data: Json };
  }>();
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  const make = useCallback(() => {
    setFailed(false);
    samplePackets("https://corpus.idem.dev/doc/3", t.sampleText)
      .then(({ interest, data }) => {
        setPackets((old) => ({
          interest: interest as unknown as Json,
          data: data as Json,
          prev: old && { interest: old.interest, data: old.data },
        }));
        setVersion((v) => v + 1);
      })
      .catch((e: unknown) => {
        // The visitor reads a translated sentence; the browser's own (English) reason goes to the console.
        console.warn("idem: could not sign the sample packets", e);
        setFailed(true);
      });
    // A new language signs a new packet, with the content in that language.
  }, [t.sampleText]);

  useEffect(make, [make]);

  const nameKey = (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-3 w-[3px] rounded-full bg-interest" />
      {t.sameName}
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Packet
          kind="interest"
          title="Interest"
          value={packets?.interest}
          prev={packets?.prev?.interest}
          version={version}
          notes={t.interestNotes}
          signed={[]}
          legend={nameKey}
        />
        <Packet
          kind="data"
          title="Data"
          value={packets?.data}
          prev={packets?.prev?.data}
          version={version}
          notes={t.dataNotes}
          signed={["name", "meta"]}
          legend={
            <>
              {nameKey}
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-3 w-4 rounded-sm bg-[color-mix(in_srgb,var(--data-bright)_22%,transparent)]"
                />
                {t.signed}
              </span>
            </>
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-faint">
        <button type="button" onClick={make} className="btn h-9 px-3.5 text-[13px]">
          <Refresh size={15} className="sign-icon" />
          {t.signAgain}
        </button>
        <span>{failed ? t.cannotSign : t.generated}</span>
      </div>
    </div>
  );
}
