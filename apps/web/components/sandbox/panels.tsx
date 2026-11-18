"use client";

import { contentDigest, type Data, parseName } from "@idem/core";
import { type ReactNode, useEffect, useState } from "react";
import { Empty, elide, Field, fixed, Verdict } from "./ui";

/** One attack and its verdict, as the Safety window lists it. */
export interface SafetyItem {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
}

/** The Safety window: every attack run on this page, newest first, with its verdict. */
export function SafetyList({
  items,
  labels,
}: {
  items: SafetyItem[];
  labels: { empty: string; rejected: string; notRejected: string };
}) {
  if (items.length === 0) return <Empty>{labels.empty}</Empty>;
  return (
    <ul className="obs-list">
      {items.map((a) => (
        <li key={a.id} className="obs-list-row row-flash" data-bad={!a.ok || undefined}>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-fg">{a.title}</span>
            <span className="ml-auto shrink-0">
              <Verdict ok={a.ok}>{a.ok ? labels.rejected : labels.notRejected}</Verdict>
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">{a.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/** An IDEM name, whole and split into its components. */
export function NameParts({
  name,
  labels,
}: {
  name: string;
  labels: { producer: string; tool: string; schema: string; args: string };
}) {
  let parts: ReturnType<typeof parseName> | undefined;
  try {
    parts = parseName(name);
  } catch {
    parts = undefined;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="t-mono text-[11.5px] leading-relaxed break-all text-fg">
        <span className="text-faint">/idem/v1/</span>
        {parts ? (
          <>
            <span>{parts.producer}</span>
            <span className="text-faint">/</span>
            <span className="text-interest">{parts.tool}</span>
            <span className="text-faint">/</span>
            <span className="text-muted">{parts.schemaDigest}</span>
            <span className="text-faint">/</span>
            <span className="text-data">{parts.argsDigest}</span>
          </>
        ) : (
          name.replace("/idem/v1/", "")
        )}
      </p>
      {parts && (
        <dl className="obs-parts">
          <dt>{labels.producer}</dt>
          <dd>{parts.producer}</dd>
          <dt>{labels.tool}</dt>
          <dd className="text-interest">{parts.tool}</dd>
          <dt>{labels.schema}</dt>
          <dd>{elide(parts.schemaDigest, 8)}</dd>
          <dt>{labels.args}</dt>
          <dd className="text-data">{elide(parts.argsDigest, 8)}</dd>
        </dl>
      )}
    </div>
  );
}

/** A recomputed digest compared with the one the packet carries. */
export function DigestCheck({
  label,
  ok,
  yes,
  no,
}: {
  label: ReactNode;
  ok: boolean | undefined;
  yes: string;
  no: string;
}) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-muted">
      <span>{label}</span>
      <span className="ml-auto">
        {ok === undefined ? (
          <span className="t-mono text-faint">…</span>
        ) : (
          <Verdict ok={ok}>{ok ? yes : no}</Verdict>
        )}
      </span>
    </p>
  );
}

/** Recompute a Data's content digest in the page (SHA-256 over the JCS content). */
export function useContentCheck(data: Data | undefined): boolean | undefined {
  const [ok, setOk] = useState<boolean>();
  useEffect(() => {
    setOk(undefined);
    if (!data) return;
    let live = true;
    contentDigest(data.content)
      .then((d) => {
        if (live) setOk(d === data.meta.contentDigest);
      })
      .catch(() => {
        if (live) setOk(false);
      });
    return () => {
      live = false;
    };
  }, [data]);
  return ok;
}

/** A Data object's signed metadata and signature block. */
export function DataFacts({
  data,
  producedAt,
  labels,
}: {
  data: Data;
  /** How to show `producedAt` (wall clock or virtual ms). */
  producedAt: string;
  labels: {
    meta: string;
    producedAt: string;
    freshness: string;
    scope: string;
    policy: string;
    signature: string;
    keyLocator: string;
    value: string;
  };
}) {
  const m = data.meta;
  return (
    <>
      <Field label={labels.meta}>
        <dl className="obs-parts">
          <dt>contentDigest</dt>
          <dd>{elide(m.contentDigest, 10)}</dd>
          <dt>{labels.producedAt}</dt>
          <dd>{producedAt}</dd>
          <dt>{labels.freshness}</dt>
          <dd>
            {m.freshnessMs >= 1000
              ? `${fixed(m.freshnessMs / 1000, m.freshnessMs % 1000 ? 1 : 0)} s`
              : `${m.freshnessMs} ms`}
          </dd>
          <dt>{labels.scope}</dt>
          <dd className={m.scope === "private" ? "text-interest" : undefined}>{m.scope}</dd>
          <dt>{labels.policy}</dt>
          <dd>{m.policyVersion}</dd>
        </dl>
      </Field>
      <Field label={labels.signature}>
        <dl className="obs-parts">
          <dt>alg</dt>
          <dd>{data.signature.alg}</dd>
          <dt>{labels.keyLocator}</dt>
          <dd className="break-all">{data.signature.keyLocator}</dd>
          <dt>{labels.value}</dt>
          <dd>{elide(data.signature.value, 12)}</dd>
        </dl>
      </Field>
    </>
  );
}
