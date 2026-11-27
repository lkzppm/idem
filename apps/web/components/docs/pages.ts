/**
 * The documentation's page tree (spec 04 §4, ADR-022). The order here is the reading order: it
 * drives the sidebar and the previous / next links. Titles and leads live in the docs dictionary
 * (`lib/i18n/messages/docs.ts`), keyed by slug.
 */

export type DocSlug =
  | "introduction"
  | "use-cases"
  | "concepts"
  | "architecture"
  | "protocol"
  | "security"
  | "api"
  | "sandbox"
  | "related-work"
  | "evaluation"
  | "decisions"
  | "references";

export type DocGroup = "learn" | "spec" | "use" | "research";

export interface DocPage {
  slug: DocSlug;
  group: DocGroup;
  /**
   * A file of the repository's `spec/` folder this page renders as is (single source: the spec
   * is never copied). Absent: the page is written in `content/docs/<locale>/<slug>.md`.
   */
  spec?: string;
  /** A Portuguese translation of the spec file exists in `content/docs/pt/<slug>.md`. */
  translated?: boolean;
  /** The spec text is normative (the protocol), not only a record. */
  normative?: boolean;
}

export const DOC_GROUPS: readonly DocGroup[] = ["learn", "spec", "use", "research"];

export const DOC_PAGES: readonly DocPage[] = [
  { slug: "introduction", group: "learn" },
  { slug: "use-cases", group: "learn" },
  { slug: "concepts", group: "learn" },
  { slug: "architecture", group: "learn" },
  { slug: "protocol", group: "spec", spec: "01-protocol.md", translated: true, normative: true },
  { slug: "security", group: "spec" },
  { slug: "api", group: "use" },
  { slug: "sandbox", group: "use" },
  { slug: "related-work", group: "research" },
  { slug: "evaluation", group: "research" },
  { slug: "decisions", group: "research", spec: "07-decisions.md" },
  { slug: "references", group: "research", spec: "08-references.md" },
];

/** The route of a page: the introduction is `/docs` itself. */
export function docHref(slug: DocSlug): string {
  return slug === "introduction" ? "/docs" : `/docs/${slug}`;
}

export function findDoc(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

/** The pages before and after `slug` in reading order. */
export function neighbours(slug: DocSlug): { previous?: DocPage; next?: DocPage } {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  const previous = i > 0 ? DOC_PAGES[i - 1] : undefined;
  const next = i >= 0 ? DOC_PAGES[i + 1] : undefined;
  return { ...(previous && { previous }), ...(next && { next }) };
}
