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
  /** Load an example (or the Live one). Undoable, except from the start screen. */
  load(id: ExampleId): void;
  /** Load the saved network. */
  resume(): void;
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

  useEffect(() => {
    // Once: the address is cleaned below, so a second run (React's development double effect)
    // would find nothing in it.
    if (started.current) return;
    started.current = true;
    setSaved(readSaved());
    setH({ past: [], present: initial(), future: [] });
    setLoaded(true);
    setLoads((n) => n + 1);
    // The query and hash were read: keep the address clean (a share link is made on request).
    const q = new URLSearchParams(window.location.search);
    q.delete("mode");
    q.delete("example");
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  // Autosave the network being edited (debounced).
  useEffect(() => {
    const p = h.present;
    if (!loaded || p.kind !== "net") return;
    const id = setTimeout(() => {
      writeSaved(p.net);
      setSaved(p.net);
    }, 300);
    return () => clearTimeout(id);
  }, [h.present, loaded]);

  const edit = useCallback((next: Network, opts?: { coalesce?: string; transient?: boolean }) => {
    setH((s) => {
      const present: Showing = { kind: "net", net: next };
      if (opts?.transient) return { ...s, present };
      const now = performance.now();
      const merge =
        opts?.coalesce !== undefined &&
        last.current.key === opts.coalesce &&
        now - last.current.at < COALESCE_MS;
      last.current = { key: opts?.coalesce, at: now };
      if (merge) return { ...s, present, future: [] };
      return push(s, present);
    });
  }, []);

  const show = useCallback((next: Showing) => {
    setH((s) => push(s, next));
    last.current = { at: 0 };
    setLoads((n) => n + 1);
  }, []);

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

  const undo = useCallback(() => {
    setH((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      if (prev.kind !== s.present.kind) setLoads((n) => n + 1);
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future] };
    });
    last.current = { at: 0 };
  }, []);
  const redo = useCallback(() => {
    setH((s) => {
      const next = s.future[0];
      if (!next) return s;
      if (next.kind !== s.present.kind) setLoads((n) => n + 1);
      return { past: [...s.past, s.present], present: next, future: s.future.slice(1) };
    });
    last.current = { at: 0 };
  }, []);

  return useMemo<NetworkState>(
    () => ({
      loaded,
      showing: h.present,
      saved,
      loads,
      edit,
      load,
      resume,
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
    [loaded, h, saved, loads, edit, load, resume, undo, redo],
  );
}
