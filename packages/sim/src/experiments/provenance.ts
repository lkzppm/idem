import { sha256, utf8 } from "@idem/core";

/**
 * Provenance of a run (05-evaluation, CLAUDE.md rule 5): which code produced it and when. The
 * checkout may not be a git repository, so besides `git-sha` every run records a digest of the
 * source files themselves.
 */

/** A source file: path relative to the repository root (forward slashes) and its bytes. */
export interface SourceFile {
  path: string;
  content: Uint8Array;
}

/** Is `path` (repo-relative) part of the code a run depends on? `packages/<pkg>/src/**`, no tests. */
export function isSourceFile(path: string): boolean {
  if (!/^packages\/[^/]+\/src\//.test(path)) return false;
  if (path.includes("/__snapshots__/")) return false;
  return !/\.test\.[cm]?[jt]sx?$/.test(path) && !/\.test-helpers\.[cm]?[jt]sx?$/.test(path);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 over the source files sorted by path: for each file, the hash absorbs
 * `<path>\0<hex sha-256 of the content>\n`. Order of `files` does not matter. Returns lowercase hex.
 */
export async function sourceDigest(files: readonly SourceFile[]): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const lines: string[] = [];
  for (const f of sorted)
    lines.push(`${f.path}\0${hex(await sha256(f.content as Uint8Array<ArrayBuffer>))}\n`);
  return hex(await sha256(utf8(lines.join(""))));
}

/** `YYYYMMDDTHHMMSSZ-<first 8 hex of the source digest>`: sorts by time, names the code. */
export function runId(at: Date, digest: string): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${digest.slice(0, 8)}`;
}

/** Is `id` shaped like a {@link runId}? */
export function isRunId(id: string): boolean {
  return /^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(id);
}
