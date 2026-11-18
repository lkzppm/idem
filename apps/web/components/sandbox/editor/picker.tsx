"use client";

import { type CSSProperties, type DragEvent, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { HTML_LANG } from "@/lib/i18n/locale";
import { editor } from "@/lib/i18n/messages/editor";
import { EXAMPLE_IDS, type ExampleId, example } from "@/lib/sandbox/examples";
import {
  downloadFile,
  exportFile,
  type ImportError,
  MAX_FILE_CHARS,
  type SavedNetwork,
  type SaveError,
} from "@/lib/sandbox/library";
import { type Network, sanitizeNetwork } from "@/lib/sandbox/network";
import {
  ArrowIcon,
  CheckIcon,
  CloseIcon,
  ExportIcon,
  ImportIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "../icons";
import type { Draft } from "./use-network";

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

/** How many saved networks show before "Show all". */
const SHOWN = 4;

type Notice = { kind: "ok" | "error"; text: string };

/** One saved network: its thumb, name, date and size; open, rename, export and delete (with a confirm). */
function LibraryCard({
  entry,
  index,
  picked,
  date,
  onOpen,
  onRename,
  onRemove,
}: {
  entry: SavedNetwork;
  index: number;
  picked: boolean;
  date: string;
  onOpen: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const t = useMessages(editor).library;
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<"idle" | "rename" | "confirm">("idle");
  const [removing, setRemoving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode === "rename") input.current?.select();
  }, [mode]);

  const commitName = () => {
    const v = input.current?.value ?? "";
    setMode("idle");
    if (v.trim() && v.trim() !== entry.name) onRename(v);
  };
  const remove = () => {
    setRemoving(true);
    window.setTimeout(onRemove, reduced ? 0 : 260);
  };

  return (
    <li
      className="obs-lib-card"
      data-picked={picked || undefined}
      data-removing={removing || undefined}
      data-mode={mode}
      style={{ "--i": index } as CSSProperties}
    >
      <NetworkThumb net={entry.net} />
      <div className="obs-lib-body">
        {mode === "confirm" ? (
          <div className="obs-lib-confirm" role="alertdialog" aria-label={t.deleteAsk(entry.name)}>
            <span className="obs-lib-ask">{t.deleteAsk(entry.name)}</span>
            <span className="obs-lib-confirm-btns">
              <button type="button" className="obs-chip-btn obs-chip-btn-solid" onClick={remove}>
                {t.deleteYes}
              </button>
              <button type="button" className="obs-chip-btn" onClick={() => setMode("idle")}>
                {t.deleteNo}
              </button>
            </span>
          </div>
        ) : (
          <>
            <div className="obs-lib-text">
              {mode === "rename" ? (
                <form
                  className="obs-name-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    commitName();
                  }}
                >
                  <input
                    ref={input}
                    className="obs-name-input"
                    aria-label={t.renameLabel}
                    defaultValue={entry.name}
                    maxLength={60}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setMode("idle");
                      }
                    }}
                    onBlur={(e) => {
                      // Leaving the field keeps the name; the tick and Enter do the same.
                      if (!e.relatedTarget) commitName();
                    }}
                  />
                  <button type="submit" className="obs-icon-btn obs-lib-tool" aria-label={t.rename}>
                    <CheckIcon size={15} />
                  </button>
                </form>
              ) : (
                <button type="button" className="obs-lib-name" title={entry.name} onClick={onOpen}>
                  <span className="obs-lib-name-text">{entry.name}</span>
                  <span className="sr-only">{t.open(entry.name)}</span>
                </button>
              )}
              <span className="obs-lib-meta">{t.meta(date, entry.net.nodes.length)}</span>
            </div>
            <div className="obs-lib-tools">
              <button
                type="button"
                className="obs-icon-btn obs-lib-tool"
                aria-label={`${t.rename}: ${entry.name}`}
                title={t.rename}
                onClick={() => setMode("rename")}
              >
                <PencilIcon size={14} />
              </button>
              <button
                type="button"
                className="obs-icon-btn obs-lib-tool"
                aria-label={`${t.exportOne}: ${entry.name}`}
                title={t.exportOne}
                onClick={() => downloadFile(exportFile(entry.name, entry.net, entry.savedAt))}
              >
                <ExportIcon size={14} />
              </button>
              <button
                type="button"
                className="obs-icon-btn obs-lib-tool"
                aria-label={`${t.deleteOne}: ${entry.name}`}
                title={t.deleteOne}
                onClick={() => setMode("confirm")}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * The start screen (ADR-029, ADR-031): what the sandbox shows when nothing is loaded. On the left, a
 * blank canvas (the big plus) and the network this browser autosaved last; on the right, the
 * visitor's saved networks (open, rename, export, delete, import a file, or drop one on the screen)
 * above the examples in a column. Picking one plays the leave animation while the workspace comes
 * in; the sidebar's back button returns here (no network is ever loaded over another).
 */
export function StartScreen({
  saved,
  library,
  leaving,
  onPick,
  onResume,
  onOpen,
  onRename,
  onRemove,
  onImport,
}: {
  saved?: Draft;
  library: SavedNetwork[];
  /** The visitor picked: the screen is animating out. */
  leaving?: boolean;
  onPick: (id: ExampleId) => void;
  onResume: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  /** Add a file's text to the library: the saved entry's name, or why not. */
  onImport: (
    text: string,
    fallbackName: string,
  ) => { ok: true; name: string } | { ok: false; error: ImportError | SaveError };
}) {
  const t = useMessages(editor);
  const L = t.library;
  const locale = useLocale();
  const [picked, setPicked] = useState<string>();
  const [all, setAll] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const file = useRef<HTMLInputElement>(null);
  const examples = EXAMPLE_IDS.filter((id) => id !== "blank");
  const pick = (id: ExampleId) => {
    setPicked(id);
    onPick(id);
  };
  const open = (id: string) => {
    setPicked(id);
    onOpen(id);
  };

  const fmt = new Intl.DateTimeFormat(HTML_LANG[locale], { day: "numeric", month: "short", year: "numeric" });

  // What the autosave holds, unless it is exactly a saved network (then the library already has it).
  const entry = saved?.lib ? library.find((e) => e.id === saved.lib) : undefined;
  const resumable =
    saved && (!entry || JSON.stringify(sanitizeNetwork(saved.net)) !== JSON.stringify(entry.net));
  const savedFrom = saved
    ? ((t.example as Record<string, { name: string }>)[saved.net.from]?.name ?? saved.net.from)
    : "";

  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const id = setTimeout(() => setNotice(undefined), 4500);
    return () => clearTimeout(id);
  }, [notice]);

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    const fail = (error: keyof typeof L.importErrors) =>
      setNotice({ kind: "error", text: L.importErrors[error] });
    if (f.size > MAX_FILE_CHARS * 4) return fail("too-big");
    let text: string;
    try {
      text = await f.text();
    } catch {
      return fail("read");
    }
    const r = onImport(text, f.name.replace(/(\.idem)?\.json$/i, "") || L.untitled);
    if (r.ok) setNotice({ kind: "ok", text: L.imported(r.name) });
    else fail(r.error);
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const shown = all ? library : library.slice(0, SHOWN);

  return (
    <div
      className="obs-start"
      data-leaving={leaving || undefined}
      inert={leaving || undefined}
      onDragEnter={(e) => hasFiles(e) && (e.preventDefault(), setDropping(true))}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        void importFile(e.dataTransfer.files[0]);
      }}
    >
      {dropping && (
        <div className="obs-drop" aria-hidden="true">
          <span className="obs-drop-card">
            <ImportIcon size={28} />
            {L.drop}
          </span>
        </div>
      )}
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
            {saved && resumable && (
              <button
                type="button"
                className="obs-row obs-resume"
                data-picked={picked === "resume" || undefined}
                onClick={() => {
                  setPicked("resume");
                  onResume();
                }}
              >
                <NetworkThumb net={saved.net} />
                <span className="obs-row-text">
                  <span className="obs-row-name">{t.picker.resume}</span>
                  <span className="obs-row-blurb">
                    {entry
                      ? L.continueUnsaved(entry.name)
                      : t.picker.resumeBlurb(savedFrom, saved.net.nodes.length)}
                  </span>
                </span>
                <span className="obs-row-go" aria-hidden="true">
                  <ArrowIcon />
                </span>
              </button>
            )}
          </div>
          <div className="obs-start-lists">
            <section className="obs-start-library" aria-labelledby="obs-library-title">
              <div className="obs-start-subrow">
                <h2 id="obs-library-title" className="obs-start-sub">
                  {L.yours}
                  {library.length > 0 && <span className="obs-start-count">{library.length}</span>}
                </h2>
                <button
                  type="button"
                  className="obs-chip-btn obs-import"
                  title={L.importTitle}
                  onClick={() => file.current?.click()}
                >
                  <ImportIcon size={14} />
                  {L.import}
                </button>
                <input
                  ref={file}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              {notice && (
                <p
                  className="obs-lib-notice"
                  data-kind={notice.kind}
                  role={notice.kind === "error" ? "alert" : "status"}
                >
                  <span>{notice.text}</span>
                  <button
                    type="button"
                    className="obs-icon-btn obs-lib-tool"
                    aria-label={L.dismiss}
                    onClick={() => setNotice(undefined)}
                  >
                    <CloseIcon />
                  </button>
                </p>
              )}
              {library.length === 0 ? (
                <div className="obs-lib-empty">
                  <NetworkThumb net={{ nodes: [], links: [] }} />
                  <span className="obs-row-text">
                    <span className="obs-row-name">{L.empty}</span>
                    <span className="obs-row-blurb">{L.emptyBody}</span>
                  </span>
                </div>
              ) : (
                <ul className="obs-lib-grid">
                  {shown.map((e, i) => (
                    <LibraryCard
                      key={e.id}
                      entry={e}
                      index={i}
                      picked={picked === e.id}
                      date={fmt.format(e.savedAt)}
                      onOpen={() => open(e.id)}
                      onRename={(name) => onRename(e.id, name)}
                      onRemove={() => onRemove(e.id)}
                    />
                  ))}
                </ul>
              )}
              {library.length > SHOWN && (
                <button type="button" className="obs-chip-btn obs-lib-more" onClick={() => setAll((v) => !v)}>
                  {all ? L.showLess : L.showAll(library.length)}
                </button>
              )}
            </section>
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
    </div>
  );
}
