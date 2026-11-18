import Link from "next/link";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/docs/code-block";
import { highlight } from "@/components/docs/highlight";

/**
 * The docs' Markdown renderer (ADR-022): a small, dependency-free renderer for the subset the spec
 * and the docs pages are written in. The spec files are the source of truth (CLAUDE.md); this
 * renders them without copying.
 *
 * Blocks: headings (`## Title {#id}`), paragraphs, nested lists, tables, fenced code, block quotes
 * and callouts (`> [!NOTE]`), rules (`---`), and directives (`::figure[name] caption`).
 * Inline: code, bold, italics, links, bare URLs.
 *
 * It also knows the spec's own conventions, so they become navigation instead of plain text:
 * a rule id (`[P-2.1]`) links to the rule in the protocol page and a rule's definition
 * (`**[P-2.1]** …`) becomes a callout with an anchor; `ADR-013` links to the decision; a reference
 * key (`[MCP-CACHE]`) links to the bibliography; `§7` links to the section inside the protocol
 * page; and the RFC 2119 keywords (MUST, SHOULD, MAY) are set apart.
 */

/** One entry of a page's table of contents. */
export interface TocEntry {
  id: string;
  /** The heading as plain text (no Markdown markers). */
  text: string;
  level: 2 | 3;
}

/** Options of {@link renderDocument}. */
export interface MarkdownOptions {
  /** Drop the document's first `# Title`: the page renders its own header. */
  skipTitle?: boolean;
  /** Where the protocol's rules live. `""` when rendering the protocol page itself. */
  rulesHref?: string;
  /** Where the ADRs live. `""` when rendering the decisions page itself. */
  adrsHref?: string;
  /** Where the bibliography lives. `""` when rendering the references page itself. */
  refsHref?: string;
  /** Reference keys that exist; `[KEY]` links only for these. */
  refs?: ReadonlySet<string>;
  /** `**[P-x.y]**` defines a rule here (the protocol page) instead of linking to one. */
  defineRules?: boolean;
  /** `**[KEY]**` defines a bibliography entry here (the references page). */
  defineRefs?: boolean;
  /** Link `§7` to this document's own numbered sections (the protocol page). */
  linkSections?: boolean;
  /** Accessible name of a heading's anchor link, given the heading text. */
  anchorLabel?: (heading: string) => string;
  /** Renders a block directive (`::name[arg] text`); return `null` to drop it. */
  directive?: (name: string, arg: string, text: string) => ReactNode;
}

/** A rendered document and its table of contents. */
export interface RenderedDocument {
  nodes: ReactNode[];
  toc: TocEntry[];
}

interface Ctx extends MarkdownOptions {
  /** Ids already used in this document (headings, rules, references). */
  ids: Set<string>;
  /** Ids of the numbered sections (`s7`, `s9-1`), known before rendering starts. */
  sections: ReadonlySet<string>;
  toc: TocEntry[];
  n: number;
  /** How deep the current block is nested (lists in lists, quotes in quotes). */
  depth: number;
}

/**
 * Past this depth a nested block is shown as plain text: every level of nesting is a level of
 * recursion, and a long run of `>` or of indented list markers must not exhaust the stack.
 */
const MAX_DEPTH = 12;

const HEADING = /^(#{1,4})\s+(.*)$/;
const HEADING_ID = /\s\{#([a-z0-9-]+)\}$/;
const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const FENCE = /^\s*```/;
const DIRECTIVE = /^::([a-z][a-z0-9-]*)\[([^\]]*)\]\s*(.*)$/;
const CALLOUT = /^\[!([A-Z]+)\]\s*(.*)$/;
const RULE_DEF = /^\*\*\[(P-\d+\.\d+)\]\*\*\s*/;

/**
 * A heading line: its level, its text and its explicit id (`## Title {#id}`). The id is split off
 * in a second, end-anchored step: one regex with a lazy text group between two runs of whitespace
 * backtracks quadratically on long runs of spaces.
 */
function parseHeading(line: string): { level: number; text: string; id: string | undefined } | undefined {
  const h = HEADING.exec(line);
  if (!h) return undefined;
  const raw = (h[2] ?? "").trimEnd();
  const id = HEADING_ID.exec(raw);
  return {
    level: h[1]?.length ?? 1,
    text: id ? raw.slice(0, id.index).trimEnd() : raw,
    id: id?.[1],
  };
}

/** Plain text of a heading: Markdown markers removed. */
function plain(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/**
 * The anchor of a heading. Numbered sections and ADRs get ids that do not depend on the wording
 * (`## 7. Forwarder behavior` → `s7`, `### 9.1 HTTP overlay` → `s9-1`, `## ADR-013 — …` →
 * `adr-013`, `## Appendix A. …` → `appendix-a`), so a link to them works in every language.
 */
export function headingId(text: string): string {
  const t = plain(text).trim();
  const adr = /^ADR-(\d+)\b/.exec(t);
  if (adr) return `adr-${adr[1]}`;
  const numbered = /^(\d+(?:\.\d+)*)\.?\s/.exec(t);
  if (numbered) return `s${(numbered[1] ?? "").replaceAll(".", "-")}`;
  const appendix = /^(?:Appendix|Apêndice)\s+([A-Z])\b/.exec(t);
  if (appendix) return `appendix-${(appendix[1] ?? "").toLowerCase()}`;
  return (
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function unique(id: string, used: Set<string>): string {
  let out = id;
  for (let n = 2; used.has(out); n++) out = `${id}-${n}`;
  used.add(out);
  return out;
}

const ruleAnchor = (rule: string): string => rule.toLowerCase().replace(".", "-");
const refAnchor = (key: string): string => `ref-${key.toLowerCase()}`;

/** The requirement level of a rule: the strongest RFC 2119 keyword in its text. */
function ruleLevel(text: string): "must" | "should" | "may" {
  if (/\bMUST\b/.test(text)) return "must";
  if (/\bSHOULD\b/.test(text)) return "should";
  if (/\bMAY\b/.test(text)) return "may";
  return "must";
}

const INLINE = new RegExp(
  [
    "(`[^`\\n]+`)", // 1 code
    "(\\*\\*[^*\\n]+\\*\\*)", // 2 bold
    "(\\*[^*\\s][^*\\n]*\\*)", // 3 italics
    // Link text stops at the next "[" and the target at the next "(": a run of unclosed brackets
    // then costs linear time, not quadratic.
    "(\\[[^[\\]\\n]+\\]\\([^()\\s]+\\))", // 4 link
    "(\\[P-\\d+\\.\\d+\\]|\\bP-\\d+\\.\\d+\\b)", // 5 rule id
    "(\\[[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\\])", // 6 reference key
    "(https?:\\/\\/[^\\s<>]+)", // 7 bare URL
    "(\\bADR-\\d{3}\\b)", // 8 decision
    "(§\\d+(?:\\.\\d+)*)", // 9 section
    "(\\b(?:MUST NOT|SHOULD NOT|MUST|SHOULD|MAY)\\b)", // 10 requirement keyword
  ].join("|"),
  "g",
);

function anchor(href: string, children: ReactNode, key: string, className?: string): ReactNode {
  if (/^https?:/.test(href)) {
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  if (href.startsWith("/")) {
    return (
      <Link key={key} href={href} className={className}>
        {children}
      </Link>
    );
  }
  if (href.startsWith("#")) {
    return (
      <a key={key} href={href} className={className}>
        {children}
      </a>
    );
  }
  // A relative link between spec files has no page of its own: keep the words.
  return <span key={key}>{children}</span>;
}

/**
 * Inline Markdown. `bare` keeps only code, bold and italics (headings: no links inside a link
 * target, no automatic references).
 */
function inline(text: string, ctx: Ctx, key: string, bare = false): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  // A regex of its own per call: `inline` recurses (bold, italics, link text), and a shared
  // `lastIndex` would be overwritten by the inner call.
  const re = new RegExp(INLINE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let tok = m[0];
    const k = `${key}.${n++}`;
    let node: ReactNode;
    if (m[1]) {
      node = <code key={k}>{tok.slice(1, -1)}</code>;
    } else if (m[2]) {
      const inner = tok.slice(2, -2);
      const rule = /^\[(P-\d+\.\d+)\]$/.exec(inner);
      const ref = /^\[([A-Z][A-Z0-9-]*)\]$/.exec(inner);
      if (rule && !bare) node = ruleTag(rule[1] ?? "", ctx, k, true);
      else if (ref && ctx.defineRefs && !bare) {
        const id = refAnchor(ref[1] ?? "");
        const fresh = !ctx.ids.has(id);
        if (fresh) ctx.ids.add(id);
        node = (
          <span key={k} id={fresh ? id : undefined} className="md-ref-key">
            {ref[1]}
          </span>
        );
      } else node = <strong key={k}>{inline(inner, ctx, k, bare)}</strong>;
    } else if (m[3]) {
      node = <em key={k}>{inline(tok.slice(1, -1), ctx, k, bare)}</em>;
    } else if (bare) {
      // Everything below is a link or an automatic reference.
      if (m[4]) {
        const lm = /^\[([^\]]+)\]/.exec(tok);
        node = <span key={k}>{inline(lm?.[1] ?? "", ctx, k, true)}</span>;
      } else node = tok;
    } else if (m[4]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      node = anchor(lm?.[2] ?? "#", inline(lm?.[1] ?? "", ctx, k, true), k);
    } else if (m[5]) {
      node = ruleTag(tok.replace(/[[\]]/g, ""), ctx, k, false);
    } else if (m[6]) {
      const name = tok.slice(1, -1);
      node =
        ctx.refs?.has(name) && ctx.refsHref !== undefined
          ? anchor(`${ctx.refsHref}#${refAnchor(name)}`, name, k, "md-ref")
          : tok;
    } else if (m[7]) {
      // Sentence punctuation after a URL is not part of it.
      const trail = /[.,;:!?)]+$/.exec(tok)?.[0] ?? "";
      if (trail) {
        tok = tok.slice(0, -trail.length);
        re.lastIndex -= trail.length;
      }
      node = anchor(tok, tok, k, "md-url");
    } else if (m[8]) {
      node =
        ctx.adrsHref !== undefined ? anchor(`${ctx.adrsHref}#${tok.toLowerCase()}`, tok, k, "md-adr") : tok;
    } else if (m[9]) {
      const id = `s${tok.slice(1).replaceAll(".", "-")}`;
      node = ctx.linkSections && ctx.sections.has(id) ? anchor(`#${id}`, tok, k, "md-sec") : tok;
    } else {
      node = (
        <strong key={k} className="md-kw">
          {tok}
        </strong>
      );
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(node);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A rule id: its definition (an anchor others link to) on the protocol page, a link elsewhere. */
function ruleTag(rule: string, ctx: Ctx, key: string, definition: boolean): ReactNode {
  const id = ruleAnchor(rule);
  if (definition && ctx.defineRules) {
    const fresh = !ctx.ids.has(id);
    if (fresh) ctx.ids.add(id);
    return (
      <a key={key} id={fresh ? id : undefined} href={`#${id}`} className="md-rule-id">
        {rule}
      </a>
    );
  }
  if (ctx.rulesHref === undefined) return <code key={key}>{rule}</code>;
  return anchor(`${ctx.rulesHref}#${id}`, rule, key, "md-rule-ref");
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string | undefined): boolean => (line ?? "").trim() === "";
const startsBlock = (line: string): boolean =>
  HEADING.test(line) ||
  FENCE.test(line) ||
  line.trim().startsWith("|") ||
  line.startsWith(">") ||
  ITEM.test(line) ||
  DIRECTIVE.test(line) ||
  /^-{3,}\s*$/.test(line);

interface Item {
  text: string[];
  child: string[];
}

function dedent(lines: string[]): string[] {
  const min = Math.min(...lines.filter((l) => !isBlank(l)).map(indentOf));
  return Number.isFinite(min) ? lines.map((l) => l.slice(Math.min(min, indentOf(l)))) : lines;
}

/** A rule's body: the tag, then the text with the leading `**[P-x.y]**` removed. */
function ruleBody(text: string, ctx: Ctx, key: string): { id: string; level: string; body: ReactNode[] } {
  const m = RULE_DEF.exec(text);
  const rule = m?.[1] ?? "";
  const rest = text.slice(m?.[0].length ?? 0);
  return {
    id: ruleAnchor(rule),
    level: ruleLevel(rest),
    body: [
      ruleTag(rule, ctx, `${key}.t`, true),
      <span key={`${key}.b`} className="md-rule-text">
        {inline(rest, ctx, key)}
      </span>,
    ],
  };
}

/** The blocks of a list item's or a quote's body, one level deeper. */
function nested(lines: string[], ctx: Ctx): ReactNode[] {
  if (ctx.depth >= MAX_DEPTH) {
    const text = lines
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
    return text ? [<p key={`b${ctx.n++}`}>{text}</p>] : [];
  }
  ctx.depth++;
  try {
    return blocks(lines, ctx);
  } finally {
    ctx.depth--;
  }
}

function blocks(lines: string[], ctx: Ctx, top = false): ReactNode[] {
  const out: ReactNode[] = [];
  const key = () => `b${ctx.n++}`;
  let i = 0;
  let titleSkipped = !(top && ctx.skipTitle);
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (isBlank(line)) {
      i++;
      continue;
    }
    // An HTML comment (translation bookkeeping) is not content.
    if (line.trimStart().startsWith("<!--")) {
      while (i < lines.length && !(lines[i] ?? "").includes("-->")) i++;
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const lang = line.trim().slice(3).trim().split(/\s+/)[0] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++;
      const code = body.join("\n");
      out.push(
        <CodeBlock key={key()} code={code} lang={lang}>
          {highlight(code, lang)}
        </CodeBlock>,
      );
      continue;
    }
    const h = parseHeading(line);
    if (h) {
      i++;
      const { level, text } = h;
      if (level === 1 && !titleSkipped) {
        titleSkipped = true;
        continue;
      }
      const id = unique(h.id ?? headingId(text), ctx.ids);
      const label = plain(text);
      if (level === 2 || level === 3) ctx.toc.push({ id, text: label, level });
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
      const k = key();
      out.push(
        <Tag key={k} id={id} className="md-h">
          {inline(text, ctx, k, true)}
          <a href={`#${id}`} className="md-anchor" aria-label={ctx.anchorLabel?.(label) ?? label}>
            #
          </a>
        </Tag>,
      );
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      i++;
      out.push(<hr key={key()} />);
      continue;
    }
    const d = DIRECTIVE.exec(line);
    if (d) {
      i++;
      const node = ctx.directive?.(d[1] ?? "", d[2] ?? "", d[3] ?? "");
      if (node) out.push(<div key={key()}>{node}</div>);
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) rows.push(lines[i++] ?? "");
      const [head, , ...body] = rows;
      const k = key();
      out.push(
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {cells(head ?? "").map((c, j) => (
                  <th key={j} scope="col">
                    {inline(c, ctx, `${k}.h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {cells(r).map((c, j) => (
                    <td key={j}>{inline(c, ctx, `${k}.${ri}.${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const first = ITEM.exec(line);
    if (first) {
      const base = first[1]?.length ?? 0;
      const ordered = /\d/.test(first[2] ?? "");
      const start = ordered ? Number.parseInt(first[2] ?? "1", 10) : 1;
      const items: Item[] = [];
      let inChild = false;
      while (i < lines.length) {
        const l = lines[i] ?? "";
        const m = ITEM.exec(l);
        const ind = indentOf(l);
        if (m && ind >= base && ind <= base + 1 && /\d/.test(m[2] ?? "") === ordered) {
          items.push({ text: [m[3] ?? ""], child: [] });
          inChild = false;
          i++;
          continue;
        }
        const cur = items[items.length - 1];
        if (!cur) break;
        if (isBlank(l)) {
          let j = i;
          while (j < lines.length && isBlank(lines[j])) j++;
          const next = lines[j];
          if (next === undefined) break;
          const nm = ITEM.exec(next);
          const ni = indentOf(next);
          if (ni >= base + 2) {
            // An indented block after a blank line still belongs to the item.
            inChild = true;
            if (cur.child.length > 0) cur.child.push("");
            i = j;
            continue;
          }
          if (nm && ni >= base && ni <= base + 1 && /\d/.test(nm[2] ?? "") === ordered) {
            i = j;
            continue;
          }
          break;
        }
        if (ind >= base + 2) {
          if (inChild || ITEM.test(l) || l.trim().startsWith("|") || FENCE.test(l)) {
            inChild = true;
            cur.child.push(l);
          } else cur.text.push(l.trim());
          i++;
          continue;
        }
        if (!inChild && !startsBlock(l)) {
          cur.text.push(l.trim());
          i++;
          continue;
        }
        break;
      }
      const List = ordered ? "ol" : "ul";
      const k = key();
      out.push(
        <List
          key={k}
          className={base >= 2 ? "md-list md-nested" : "md-list"}
          {...(ordered && start !== 1 && { start })}
        >
          {items.map((it, j) => {
            const text = it.text.join(" ");
            const child = it.child.length > 0 ? nested(dedent(it.child), ctx) : null;
            const ik = `${k}.${j}`;
            if (RULE_DEF.test(text) && ctx.defineRules) {
              const r = ruleBody(text, ctx, ik);
              return (
                <li key={j} className="md-rule" data-level={r.level}>
                  {r.body}
                  {child}
                </li>
              );
            }
            return (
              <li key={j}>
                {inline(text, ctx, ik)}
                {child}
              </li>
            );
          })}
        </List>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith(">"))
        body.push((lines[i++] ?? "").replace(/^>\s?/, ""));
      const c = CALLOUT.exec(body[0] ?? "");
      const kind = c ? (c[1] ?? "NOTE").toLowerCase() : "quote";
      const title = c?.[2] ?? "";
      const k = key();
      out.push(
        <aside key={k} className="md-callout" data-kind={kind}>
          {title && <p className="md-callout-title">{inline(title, ctx, `${k}.t`)}</p>}
          {nested(c ? body.slice(1) : body, ctx)}
        </aside>,
      );
      continue;
    }
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (isBlank(l) || startsBlock(l)) break;
      // A line that opens with a bold lead-in ("**Decision.** …") starts its own paragraph.
      if (/^\*\*[^*]+[.:]\*\*/.test(l.trim())) break;
      para.push(l.trim());
      i++;
    }
    const text = para.join(" ");
    const k = key();
    if (RULE_DEF.test(text) && ctx.defineRules) {
      const r = ruleBody(text, ctx, k);
      out.push(
        <p key={k} className="md-rule" data-level={r.level}>
          {r.body}
        </p>,
      );
    } else {
      out.push(<p key={k}>{inline(text, ctx, k)}</p>);
    }
  }
  return out;
}

/** The ids of a document's numbered sections (`s7`, `s9-1`), read from its headings. */
function sectionIds(lines: string[]): Set<string> {
  const ids = new Set<string>();
  let fenced = false;
  for (const l of lines) {
    if (FENCE.test(l)) fenced = !fenced;
    if (fenced) continue;
    const h = parseHeading(l);
    if (!h) continue;
    const id = h.id ?? headingId(h.text);
    if (/^s\d/.test(id)) ids.add(id);
  }
  return ids;
}

/** Render a Markdown document to React elements, with its table of contents. */
export function renderDocument(src: string, opts: MarkdownOptions = {}): RenderedDocument {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const ctx: Ctx = { ...opts, ids: new Set(), sections: sectionIds(lines), toc: [], n: 0, depth: 0 };
  const nodes = blocks(lines, ctx, true);
  return { nodes, toc: ctx.toc };
}

/** Render a Markdown document to React elements. */
export function renderMarkdown(src: string, opts: MarkdownOptions = {}): ReactNode[] {
  return renderDocument(src, opts).nodes;
}
