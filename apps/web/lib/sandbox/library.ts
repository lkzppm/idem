/**
 * The visitor's networks in this browser (ADR-031): the ones they saved from the editor, kept in
 * `localStorage`, and the file format they are exported to and imported from. Everything read back,
 * from storage or from a file, goes through `sanitizeNetwork`: neither is trusted. Every storage
 * access is wrapped: a private window may throw, and then the library is simply empty.
 */
import { type Network, sanitizeNetwork } from "./network";

/** The library's storage key. The shape is `{ v: 1, items: SavedNetwork[] }`. */
export const LIBRARY_KEY = "idem.sandbox.library.v1";
/** The most networks kept; saving a new one beyond it is refused (the visitor deletes one first). */
export const MAX_NETWORKS = 40;
/** The largest single network kept (its JSON, in characters). */
export const MAX_NETWORK_CHARS = 200_000;
/** The largest file an import reads (characters). */
export const MAX_FILE_CHARS = 1_000_000;
/** The longest name. */
export const MAX_NAME = 60;
/** The `format` field of an exported file. */
export const FILE_FORMAT = "idem-network";

/** A network the visitor saved. */
export interface SavedNetwork {
  id: string;
  /** What the visitor calls it (1 to `MAX_NAME` characters). */
  name: string;
  /** Epoch milliseconds of the last save. */
  savedAt: number;
  net: Network;
}

/** Why a write was refused: no room (count), a network too large, or storage that failed or is absent. */
export type SaveError = "full" | "too-big" | "storage";
/** Why a file was not imported. */
export type ImportError = "too-big" | "not-json" | "not-network";

export type SaveResult = { ok: true; entry: SavedNetwork } | { ok: false; error: SaveError };
export type ImportResult = { ok: true; name: string; net: Network } | { ok: false; error: ImportError };

/** A name made fit to store: whitespace collapsed, trimmed, cut to `MAX_NAME`; `fallback` when empty. */
export function cleanName(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim() : "";
  return s || fallback;
}

function readAll(): SavedNetwork[] {
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const items = (JSON.parse(raw) as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    const out: SavedNetwork[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const r = it as Record<string, unknown>;
      const net = sanitizeNetwork(r.net);
      if (!net || typeof r.id !== "string" || r.id === "" || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({
        id: r.id,
        name: cleanName(r.name, "Network"),
        savedAt: typeof r.savedAt === "number" && Number.isFinite(r.savedAt) ? r.savedAt : 0,
        net,
      });
    }
    return out.slice(0, MAX_NETWORKS);
  } catch {
    return [];
  }
}

function writeAll(items: SavedNetwork[]): boolean {
  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ v: 1, items }));
    return true;
  } catch {
    return false;
  }
}

/** The saved networks, most recently saved first. */
export function listNetworks(): SavedNetwork[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

/** One saved network, or `undefined`. */
export function getNetwork(id: string): SavedNetwork | undefined {
  return readAll().find((e) => e.id === id);
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Save a network: with `id` of an existing entry it replaces its network (and its name, when one is
 * given); without, it creates an entry. `now` is the clock, `makeId` the id source (tests set both).
 */
export function saveNetwork(
  input: { id?: string; name?: string; net: Network },
  now: number = Date.now(),
  makeId: () => string = newId,
): SaveResult {
  if (JSON.stringify(input.net).length > MAX_NETWORK_CHARS) return { ok: false, error: "too-big" };
  const items = readAll();
  const at = input.id === undefined ? -1 : items.findIndex((e) => e.id === input.id);
  const prev = at >= 0 ? items[at] : undefined;
  if (!prev && items.length >= MAX_NETWORKS) return { ok: false, error: "full" };
  const entry: SavedNetwork = {
    id: prev ? prev.id : makeId(),
    name: cleanName(input.name, prev?.name ?? "Network"),
    savedAt: now,
    net: input.net,
  };
  if (prev) items[at] = entry;
  else items.push(entry);
  return writeAll(items) ? { ok: true, entry } : { ok: false, error: "storage" };
}

/** Rename an entry; `false` when it does not exist or storage failed. */
export function renameNetwork(id: string, name: string): boolean {
  const items = readAll();
  const e = items.find((x) => x.id === id);
  if (!e) return false;
  e.name = cleanName(name, e.name);
  return writeAll(items);
}

/** Delete an entry; `false` when it does not exist or storage failed. */
export function deleteNetwork(id: string): boolean {
  const items = readAll();
  const rest = items.filter((x) => x.id !== id);
  return rest.length !== items.length && writeAll(rest);
}

/** An exported file: its name and its text. */
export interface NetworkFile {
  filename: string;
  text: string;
}

/** A file name made of the network's name: letters, digits and dashes, then `.idem.json`. */
export function fileName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "network"}.idem.json`;
}

/** What `exportFile` writes: `{ format, v, name, savedAt, network }`. */
export function exportFile(name: string, net: Network, now: number = Date.now()): NetworkFile {
  const body = { format: FILE_FORMAT, v: 1, name: cleanName(name, "Network"), savedAt: now, network: net };
  return { filename: fileName(name), text: `${JSON.stringify(body, null, 2)}\n` };
}

/**
 * Read an exported file (or a bare network's JSON) from its text. The network is validated and
 * repaired by `sanitizeNetwork`; `fallbackName` names a file that carries none.
 */
export function parseImport(text: string, fallbackName: string): ImportResult {
  if (text.length > MAX_FILE_CHARS) return { ok: false, error: "too-big" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not-json" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "not-network" };
  const r = raw as Record<string, unknown>;
  const wrapped = r.format === FILE_FORMAT;
  const net = sanitizeNetwork(wrapped ? r.network : raw);
  if (!net) return { ok: false, error: "not-network" };
  if (JSON.stringify(net).length > MAX_NETWORK_CHARS) return { ok: false, error: "too-big" };
  return { ok: true, name: cleanName(wrapped ? r.name : undefined, fallbackName), net };
}

/** Hand the visitor a file to save (a browser download). */
export function downloadFile(file: NetworkFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
