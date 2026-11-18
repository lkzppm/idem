import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import type { Locale } from "@/lib/i18n/locale";
import type { DocPage } from "./pages";

/**
 * Where the docs' text comes from (ADR-022). Markdown is read from disk when a page renders:
 * written pages from `apps/web/content/docs/<locale>/<slug>.md`, and the normative pages from the
 * repository's `spec/` folder itself, so the site can never show a protocol the spec does not say.
 */

const SPEC_DIR = path.join(process.cwd(), "..", "..", "spec");
const CONTENT_DIR = path.join(process.cwd(), "content", "docs");

const read = cache(async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
});

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** What a docs page shows, and how it relates to the spec. */
export interface LoadedDoc {
  markdown: string;
  /**
   * - `written`: a docs page in the reader's language;
   * - `fallback`: a docs page with no text in the reader's language yet, shown in English;
   * - `spec`: a spec file, rendered as is (English);
   * - `translation`: a translation of a spec file.
   */
  kind: "written" | "fallback" | "spec" | "translation";
  /** The spec file behind the page, as a repository path (`spec/01-protocol.md`). */
  specPath?: string;
  /** The spec changed after the translation was made: the translation may be behind. */
  stale?: boolean;
}

/**
 * A translation records the spec text it was made from in its first line:
 * `<!-- translated-from: spec/01-protocol.md sha256:<hex> -->`. If the spec's digest no longer
 * matches, the page says so instead of silently showing an outdated translation.
 */
function translatedFrom(markdown: string): string | undefined {
  return /^<!--\s*translated-from:\s*\S+\s+sha256:([0-9a-f]{64})\s*-->/.exec(markdown)?.[1];
}

/**
 * Load a page's Markdown. `original` asks for the spec's own text even when a translation exists
 * (the "read the normative text" link).
 */
export async function loadDoc(
  page: DocPage,
  locale: Locale,
  opts: { original?: boolean } = {},
): Promise<LoadedDoc | undefined> {
  if (page.spec) {
    const specPath = `spec/${page.spec}`;
    const spec = await read(path.join(SPEC_DIR, page.spec));
    if (locale !== "en" && page.translated && !opts.original) {
      const translation = await read(path.join(CONTENT_DIR, locale, `${page.slug}.md`));
      if (translation !== undefined) {
        const from = translatedFrom(translation);
        const stale = spec !== undefined && from !== undefined && from !== sha256(spec);
        return { markdown: translation, kind: "translation", specPath, stale };
      }
    }
    return spec === undefined ? undefined : { markdown: spec, kind: "spec", specPath };
  }
  const own = await read(path.join(CONTENT_DIR, locale, `${page.slug}.md`));
  if (own !== undefined) return { markdown: own, kind: "written" };
  const english = locale === "en" ? undefined : await read(path.join(CONTENT_DIR, "en", `${page.slug}.md`));
  return english === undefined ? undefined : { markdown: english, kind: "fallback" };
}

/** The keys of the bibliography (`spec/08-references.md`), so `[KEY]` links only to real entries. */
export const referenceKeys = cache(async (): Promise<ReadonlySet<string>> => {
  const src = (await read(path.join(SPEC_DIR, "08-references.md"))) ?? "";
  return new Set([...src.matchAll(/^- \*\*\[([A-Z0-9-]+)\]\*\*/gm)].map((m) => m[1] ?? ""));
});
