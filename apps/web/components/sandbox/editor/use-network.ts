"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXAMPLE_IDS, type ExampleId, example } from "@/lib/sandbox/examples";
import { decodeNetwork, encodeNetwork, type Network } from "@/lib/sandbox/network";

const STORAGE_KEY = "idem.sandbox.network.v1";
/** Edits with the same key within this window merge into one undo step (a slider drag, a node drag). */
const COALESCE_MS = 700;
const HISTORY = 80;

/**
 * What the sandbox shows: nothing yet (the start screen, where the visitor picks what to load), the
 * Live example (real HTTP), or a network from the editor.
 */
export type Showing = { kind: "none" } | { kind: "live" } | { kind: "net"; net: Network };

function readSaved(): Network | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? (JSON.parse(raw) as { n?: unknown }).n : undefined;
    return typeof n === "string" ? decodeNetwork(n) : undefined;
  } catch {
    return undefined;
  }
}

function writeSaved(net: Network): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ n: encodeNetwork(net) }));
  } catch {
    // No storage (private window): the network lasts for this visit.
  }
}

/**
 * Where the sandbox starts: a shared network (`#n=` in the URL), an example named in the query
 * (`?example=regional`, or `?mode=swarm` / `?mode=live` from links made before the editor), or
 * nothing: the start screen, where the visitor picks (the network this browser saved is one choice).
 */
function initial(): Showing {
  const hash = new URLSearchParams(window.location.hash.slice(1)).get("n");
  const shared = hash ? decodeNetwork(hash) : undefined;
  if (shared) return { kind: "net", net: shared };
  const q = new URLSearchParams(window.location.search);
  const mode = q.get("mode");
  const ex = q.get("example") ?? (mode === "swarm" || mode === "live" ? mode : null);
  if (ex && (EXAMPLE_IDS as string[]).includes(ex)) {
    const net = example(ex as ExampleId);
    return net ? { kind: "net", net } : { kind: "live" };
  }
  return { kind: "none" };
}

/** The editor's state, with history. */
export interface NetworkState {
  /** False until the address and storage were read (the first render shows the start screen). */
  loaded: boolean;
  showing: Showing;
  /** The network this browser saved last, offered on the start screen. */
  saved: Network | undefined;
  /** Bumped when a whole network is loaded (fit the camera, replay the entrance). */
  loads: number;
  /**
   * Apply an edit. Edits sharing `coalesce` within a short window are one undo step; a `transient`
   * edit (a drag in progress) changes the network without touching the history at all.
   */
  edit(next: Network, opts?: { coalesce?: string; transient?: boolean }): void;
  /** Load an example (or the Live one) from the start screen. Its history starts empty. */
  load(id: ExampleId): void;
  /** Load the saved network. */
  resume(): void;
  /** Back to the start screen. The network being edited is saved first (Resume offers it). */
  back(): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  /** A link to what is showing (`#n=…`, or `?example=live`). */
  shareUrl(): string | undefined;
}

type History = { past: Showing[]; present: Showing; future: Showing[] };

/** Push `next` as the present; the start screen is never a step to go back to. */
const push = (s: History, next: Showing): History => ({
  past: s.present.kind === "none" ? s.past : [...s.past, s.present].slice(-HISTORY),
  present: next,
  future: [],
});

export function useNetwork(): NetworkState {
  const [h, setH] = useState<History>({ past: [], present: { kind: "none" }, future: [] });
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<Network>();
  const [loads, setLoads] = useState(0);
  const last = useRef<{ key?: string; at: number }>({ at: 0 });
  const started = useRef(false);
  /** The history as of the last change, so handlers compute the next one outside React's updaters. */
  const hist = useRef(h);
  /** Which load each showing descends from: an undo across two loads refits like a load. */
  const origin = useRef(new WeakMap<Showing, number>());
  const loadSeq = useRef(0);
  /** Set by an edit, cleared by a load: only the visitor's own work is autosaved. */
  const dirty = useRef(false);

  const commit = useCallback((next: History) => {
    hist.current = next;
    setH(next);
  }, []);

  useEffect(() => {
    // Once: the address is cleaned below, so a second run (React's development double effect)
    // would find nothing in it.
    if (started.current) return;
    started.current = true;
    setSaved(readSaved());
    const present = initial();
    origin.current.set(present, ++loadSeq.current);
    commit({ past: [], present, future: [] });
    setLoaded(true);
    setLoads((n) => n + 1);
    // The query and hash were read: keep the address clean (a share link is made on request).
    const q = new URLSearchParams(window.location.search);
    q.delete("mode");
    q.delete("example");
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [commit]);

  // Autosave the network being edited (debounced). Opening an example or a link saves nothing.
  useEffect(() => {
    const p = h.present;
    if (!loaded || p.kind !== "net" || !dirty.current) return;
    const id = setTimeout(() => {
      writeSaved(p.net);
      setSaved(p.net);
    }, 300);
    return () => clearTimeout(id);
  }, [h.present, loaded]);

  const edit = useCallback(
    (next: Network, opts?: { coalesce?: string; transient?: boolean }) => {
      const s = hist.current;
      const present: Showing = { kind: "net", net: next };
      const from = origin.current.get(s.present);
      if (from !== undefined) origin.current.set(present, from);
      dirty.current = true;
      if (opts?.transient) return commit({ ...s, present });
      const now = performance.now();
      const merge =
        opts?.coalesce !== undefined &&
        last.current.key === opts.coalesce &&
        now - last.current.at < COALESCE_MS;
      last.current = { key: opts?.coalesce, at: now };
      commit(merge ? { ...s, present, future: [] } : push(s, present));
    },
    [commit],
  );

  const show = useCallback(
    (next: Showing) => {
      origin.current.set(next, ++loadSeq.current);
      dirty.current = false;
      // Networks are only loaded from the start screen (never over another): a fresh history.
      commit({ past: [], present: next, future: [] });
      last.current = { at: 0 };
      setLoads((n) => n + 1);
    },
    [commit],
  );

  const load = useCallback(
    (id: ExampleId) => {
      const net = example(id);
      show(net ? { kind: "net", net } : { kind: "live" });
    },
    [show],
  );

  const resume = useCallback(() => {
    const net = readSaved();
    if (net) show({ kind: "net", net });
  }, [show]);

  const back = useCallback(() => {
    const p = hist.current.present;
    // The debounced autosave would be cancelled by leaving: save now.
    if (p.kind === "net" && dirty.current) {
      writeSaved(p.net);
      setSaved(p.net);
    }
    dirty.current = false;
    last.current = { at: 0 };
    commit({ past: [], present: { kind: "none" }, future: [] });
  }, [commit]);

  /** Move to `to` in the history; crossing from one load to another refits like a load. */
  const travel = useCallback(
    (s: History, next: History) => {
      if (origin.current.get(next.present) !== origin.current.get(s.present)) setLoads((n) => n + 1);
      commit(next);
      last.current = { at: 0 };
    },
    [commit],
  );
  const undo = useCallback(() => {
    const s = hist.current;
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    travel(s, { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future] });
  }, [travel]);
  const redo = useCallback(() => {
    const s = hist.current;
    const next = s.future[0];
    if (!next) return;
    travel(s, { past: [...s.past, s.present], present: next, future: s.future.slice(1) });
  }, [travel]);

  return useMemo<NetworkState>(
    () => ({
      loaded,
      showing: h.present,
      saved,
      loads,
      edit,
      load,
      resume,
      back,
      undo,
      redo,
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
      shareUrl: () => {
        const p = h.present;
        if (p.kind === "none") return undefined;
        const u = new URL(window.location.href);
        u.search = "";
        if (p.kind === "live") {
          u.searchParams.set("example", "live");
          u.hash = "";
        } else u.hash = `n=${encodeNetwork(p.net)}`;
        return u.toString();
      },
    }),
    [loaded, h, saved, loads, edit, load, resume, back, undo, redo],
  );
}
