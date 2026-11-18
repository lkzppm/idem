"use client";

import { type CSSProperties, useEffect, useId, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { landing } from "@/lib/i18n/messages/landing";
import { type Named, nameFetchPage } from "@/lib/idem-demo";

const PRESETS: { a: string; b: string }[] = [
  { a: "https://EXAMPLE.com:443/p?b=2&a=1#x", b: "https://example.com/p?a=1&b=2" },
  { a: "https://corpus.idem.dev/doc/3", b: "https://corpus.idem.dev/doc/4" },
];

function useNamed(url: string): Named | undefined {
  const [out, setOut] = useState<Named>();
  useEffect(() => {
    let stale = false;
    void nameFetchPage({ url }).then((r) => {
      if (!stale) setOut(r);
    });
    return () => {
      stale = true;
    };
  }, [url]);
  return out;
}

/**
 * A digest whose characters roll in, one after another, when `roll` is set (a preset was picked).
 * Typing swaps it instantly: a keystroke must never wait on an animation.
 */
function Digest({ value, roll, className }: { value: string; roll: boolean; className: string }) {
  if (!roll) return <span className={className}>{value}</span>;
  return (
    <span key={value} className={className}>
      {Array.from(value).map((c, i) => (
        <span key={`${i}${c}`} className="roll" style={{ "--i": i } as CSSProperties}>
          {c}
        </span>
      ))}
    </span>
  );
}

function NameLine({ named, roll }: { named: Named | undefined; roll: boolean }) {
  const t = useMessages(landing).live;
  if (!named) return <span className="text-faint">{t.computing}</span>;
  if (!named.ok) {
    return (
      <span className="font-sans text-muted">
        {t.notIdem}
        {named.code && (
          <>
            {" "}
            (<span className="t-mono text-fg">{named.code}</span>)
          </>
        )}
        . {t.fallback}
      </span>
    );
  }
  return (
    <span className="break-all">
      <span className="text-faint">/idem/v1/</span>
      <span className="text-fg">demo.idem.dev</span>
      <span className="text-faint">/</span>
      <span className="text-fg">fetch_page</span>
      <span className="text-faint">/</span>
      <span className="text-muted">{named.schemaDigest}</span>
      <span className="text-faint">/</span>
      <Digest value={named.argsDigest} roll={roll} className="text-interest" />
    </span>
  );
}

function Side({
  tag,
  url,
  named,
  roll,
  onChange,
}: {
  tag: "A" | "B";
  url: string;
  named: Named | undefined;
  roll: boolean;
  onChange: (v: string) => void;
}) {
  const t = useMessages(landing).live;
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <span className="nb-tag">{tag}</span>
        <label htmlFor={id} className="t-label">
          <span className="t-mono text-muted">fetch_page</span> · {t.field}
        </label>
      </div>
      <input
        id={id}
        value={url}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="t-mono w-full rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-[13px] text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-interest focus:shadow-[0_0_0_3px_var(--interest-soft)]"
      />
      <dl className="t-mono flex flex-col gap-3 text-[12.5px] leading-relaxed">
        <div>
          <dt className="t-label mb-1">{t.canonical}</dt>
          <dd className="break-all text-fg">
            {named?.ok ? named.jcs : <span className="text-faint">—</span>}
          </dd>
        </div>
        <div>
          <dt className="t-label mb-1">{t.name}</dt>
          <dd>
            <NameLine named={named} roll={roll} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Two calls side by side, named live by `@idem/core` in the browser. Equivalent spellings of the
 * same URL canonicalize to the same bytes and therefore to the same name; a seal on the seam
 * between them says so ("=" in the answer's yellow) or says they differ ("≠"), and springs each
 * time the verdict changes.
 */
export function NameBuilder() {
  const t = useMessages(landing).live;
  const [a, setA] = useState(PRESETS[0]?.a ?? "");
  const [b, setB] = useState(PRESETS[0]?.b ?? "");
  const [roll, setRoll] = useState(false);
  const na = useNamed(a);
  const nb = useNamed(b);
  const same = !!(na?.ok && nb?.ok && na.name === nb.name);
  const known = na !== undefined && nb !== undefined;

  return (
    <div className="fig-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3 sm:px-6">
        <span className="t-label">{t.try}</span>
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((p, i) => {
            const active = a === p.a && b === p.b;
            return (
              <button
                key={p.a}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setRoll(true);
                  setA(p.a);
                  setB(p.b);
                }}
                className={`pressable rounded-md px-2 py-1 text-[13px] underline underline-offset-4 hover:bg-subtle hover:text-fg hover:decoration-current ${
                  active ? "text-fg decoration-line-strong" : "text-muted decoration-transparent"
                }`}
              >
                {t.presets[i]}
              </button>
            );
          })}
        </div>
        <span
          aria-live="polite"
          className={`ml-auto text-[13px] font-semibold transition-colors duration-300 ${same ? "text-data" : "text-muted"}`}
        >
          {!known ? t.naming : same ? t.same : t.different}
        </span>
      </div>
      <div className="relative grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
        <Side
          tag="A"
          url={a}
          named={na}
          roll={roll}
          onChange={(v) => {
            setRoll(false);
            setA(v);
          }}
        />
        <Side
          tag="B"
          url={b}
          named={nb}
          roll={roll}
          onChange={(v) => {
            setRoll(false);
            setB(v);
          }}
        />
        {known && (
          <span
            key={same ? "same" : "diff"}
            aria-hidden="true"
            className={`nb-seal ${same ? "is-same" : ""}`}
          >
            {same ? "=" : "≠"}
          </span>
        )}
      </div>
      <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-faint sm:px-6">
        {t.footnote[0]}
        <span className="t-mono text-muted">{t.footnote[1]}</span>
        {t.footnote[2]}
        <span className="t-mono text-muted">{t.footnote[3]}</span>
        {t.footnote[4]}
      </p>
    </div>
  );
}
