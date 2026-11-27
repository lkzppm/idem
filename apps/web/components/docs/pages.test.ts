import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n/locale";
import { docs } from "@/lib/i18n/messages/docs";
import { renderDocument } from "@/lib/markdown";
import { isFigureName } from "./figures";
import { DOC_GROUPS, DOC_PAGES, type DocPage, neighbours } from "./pages";

/**
 * The docs' page tree against the files behind it (spec 04 §4, ADR-022, ADR-035). The site cannot be
 * opened in a test, so this checks what can be checked from the sources: every page has its text in
 * both languages, the two languages have the same anchors, every internal link lands on a page and
 * an anchor that exist, and every `[KEY]` a page cites is an entry of the bibliography.
 */

const WEB = path.join(import.meta.dirname, "..", "..");
const CONTENT = path.join(WEB, "content", "docs");
const SPEC = path.join(WEB, "..", "..", "spec");

const read = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, "utf8") : undefined;

/** The Markdown a page shows in `locale`, as `components/docs/content.ts` chooses it. */
function source(page: DocPage, locale: Locale): string | undefined {
  const written = read(path.join(CONTENT, locale, `${page.slug}.md`));
  if (!page.spec) return written;
  return (locale !== "en" && page.translated ? written : undefined) ?? read(path.join(SPEC, page.spec));
}

/** The anchors a page offers: its headings, its rules (`#p-8-6`) and its bibliography entries. */
function anchors(src: string): Set<string> {
  const ids = new Set(renderDocument(src, { skipTitle: true }).toc.map((e) => e.id));
  for (const m of src.matchAll(/\*\*\[(P-\d+\.\d+)\]\*\*/g))
    ids.add((m[1] ?? "").toLowerCase().replace(".", "-"));
  return ids;
}

/** A page's own text without code, so that an example such as `[REF-KEY]` is not read as a citation. */
const prose = (src: string): string => src.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

const written = DOC_PAGES.filter((p) => !p.spec);
const references = read(path.join(SPEC, "08-references.md")) ?? "";
const keys = new Set([...references.matchAll(/^- \*\*\[([A-Z0-9-]+)\]\*\*/gm)].map((m) => m[1] ?? ""));

describe("docs: the page tree", () => {
  it("has a title and a lead for every page, in every language", () => {
    for (const locale of LOCALES) {
      for (const page of DOC_PAGES) {
        expect(docs[locale].pages[page.slug].title, `${locale}/${page.slug}`).not.toBe("");
        expect(docs[locale].pages[page.slug].lead, `${locale}/${page.slug}`).not.toBe("");
      }
    }
  });

  it("keeps the reading order of spec 04 §4", () => {
    expect(DOC_PAGES.map((p) => p.slug)).toEqual([
      "introduction",
      "use-cases",
      "concepts",
      "architecture",
      "protocol",
      "security",
      "api",
      "sandbox",
      "related-work",
      "evaluation",
      "decisions",
      "references",
    ]);
    // Groups are contiguous and in the sidebar's order, so previous / next never jumps back.
    const groups = DOC_PAGES.map((p) => p.group).filter((g, i, all) => g !== all[i - 1]);
    expect(groups).toEqual([...DOC_GROUPS]);
    expect(neighbours("use-cases")).toMatchObject({
      previous: { slug: "introduction" },
      next: { slug: "concepts" },
    });
    expect(neighbours("related-work")).toMatchObject({
      previous: { slug: "sandbox" },
      next: { slug: "evaluation" },
    });
  });

  it("has the text of every page: written pages in both languages, spec pages in the spec", () => {
    for (const page of DOC_PAGES) {
      for (const locale of LOCALES) expect(source(page, locale), `${locale}/${page.slug}`).toBeDefined();
    }
  });
});

describe("docs: written pages", () => {
  it("have the same headings and anchors in English and in Portuguese", () => {
    for (const page of written) {
      const toc = (locale: Locale) =>
        renderDocument(source(page, locale) ?? "").toc.map((e) => `${"#".repeat(e.level)} ${e.id}`);
      expect(toc("pt"), page.slug).toEqual(toc("en"));
    }
  });

  it("link only to pages and anchors that exist", () => {
    const pageAnchors = new Map<string, Set<string>>();
    const anchorsOf = (page: DocPage, locale: Locale): Set<string> => {
      const k = `${locale}/${page.slug}`;
      let ids = pageAnchors.get(k);
      if (!ids) {
        ids = anchors(source(page, locale) ?? "");
        pageAnchors.set(k, ids);
      }
      return ids;
    };
    for (const page of written) {
      for (const locale of LOCALES) {
        const src = prose(source(page, locale) ?? "");
        for (const m of src.matchAll(/\]\((\/docs[^()\s]*|#[^()\s]+)\)/g)) {
          const href = m[1] ?? "";
          const [route = "", fragment] = href.split("#");
          const slug =
            route === "" ? page.slug : route === "/docs" ? "introduction" : route.slice("/docs/".length);
          const target = DOC_PAGES.find((p) => p.slug === slug);
          expect(target, `${locale}/${page.slug}: ${href}`).toBeDefined();
          // ADRs and bibliography entries are checked by their own conventions, not here.
          if (!target || !fragment || /^(adr|ref)-/.test(fragment)) continue;
          expect(anchorsOf(target, locale).has(fragment), `${locale}/${page.slug}: ${href}`).toBe(true);
        }
      }
    }
  });

  it("cite only reference keys that spec/08-references.md defines [ADR-035]", () => {
    expect(keys.size).toBeGreaterThan(0);
    for (const page of written) {
      for (const locale of LOCALES) {
        // Links are removed first: `[text](href)` is not a citation.
        const src = prose(source(page, locale) ?? "").replace(/\[[^[\]\n]+\]\([^()\s]+\)/g, "");
        for (const m of src.matchAll(/\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\]/g)) {
          const key = m[1] ?? "";
          if (/^P-\d/.test(key)) continue;
          expect(keys.has(key), `${locale}/${page.slug}: [${key}]`).toBe(true);
        }
      }
    }
  });

  it("cite the same sources, in the same order, in both languages", () => {
    const cited = (page: DocPage, locale: Locale) =>
      [...prose(source(page, locale) ?? "").matchAll(/\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\](?!\()/g)].map(
        (m) => m[1],
      );
    for (const page of written) expect(cited(page, "pt"), page.slug).toEqual(cited(page, "en"));
  });

  it("use only figures that exist", () => {
    for (const page of written) {
      for (const locale of LOCALES) {
        for (const m of (source(page, locale) ?? "").matchAll(/^::figure\[([^\]]*)\]/gm)) {
          expect(isFigureName(m[1] ?? ""), `${locale}/${page.slug}: ${m[0]}`).toBe(true);
        }
      }
    }
  });
});

describe("docs: the bibliography", () => {
  it("gives every entry a key the renderer can link, once", () => {
    const entries = references.split("\n").filter((l) => l.startsWith("- "));
    const found = entries.map((l) => /^- \*\*\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\]\*\*/.exec(l)?.[1]);
    expect(found.filter((k) => k === undefined)).toEqual([]);
    expect(new Set(found).size).toBe(found.length);
  });

  it("pins [ARCTICSWARM] to the version that has the table [ADR-035]", () => {
    const entry = references.split("\n").find((l) => l.startsWith("- **[ARCTICSWARM]**")) ?? "";
    expect(entry).toContain("arXiv:2609.01870v1");
    expect(entry).toContain("Table 21");
  });
});
