import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type MarkdownOptions, renderDocument, renderMarkdown } from "./markdown";

/** Render Markdown to an HTML string. No option makes a `/…` link here, so `next/link` is not rendered. */
const html = (src: string, opts: MarkdownOptions = {}): string =>
  renderToStaticMarkup(createElement(Fragment, null, ...renderMarkdown(src, opts)));

const count = (s: string, needle: string): number => s.split(needle).length - 1;

/** Milliseconds `fn` takes. */
const timed = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("markdown: inline tokens", () => {
  it("keeps every token when inline markup recurses (a regex per call, no shared lastIndex)", () => {
    const src = "**bold `a`** then `b`, *it `c`* and [link `d`](#t) and **e** end";
    const out = html(src);
    expect(out).toBe(
      "<p><strong>bold <code>a</code></strong> then <code>b</code>, <em>it <code>c</code></em> and " +
        '<a href="#t">link <code>d</code></a> and <strong>e</strong> end</p>',
    );
    // A second render of the same text is identical: nothing is left over between calls.
    expect(html(src)).toBe(out);
  });

  it("leaves sentence punctuation after a bare URL outside the link", () => {
    const out = html("See https://example.com/a. Then https://example.com/b), done.");
    expect(out).toContain('<a href="https://example.com/a" target="_blank" rel="noreferrer" class="md-url">');
    expect(out).toContain("</a>. Then ");
    expect(out).toContain('<a href="https://example.com/b" target="_blank" rel="noreferrer" class="md-url">');
    expect(out).toContain("</a>), done.");
  });
});

describe("markdown: nesting", () => {
  it("caps nested quotes instead of overflowing the stack", () => {
    let out = "";
    expect(() => {
      out = html(`${">".repeat(2000)} deep`);
    }).not.toThrow();
    expect(out).toContain("deep");
    // MAX_DEPTH (12) levels of nesting below the top-level quote, then plain text.
    expect(count(out, "<aside")).toBeLessThanOrEqual(13);
  });

  it("caps nested list items", () => {
    const src = Array.from({ length: 600 }, (_, i) => `${"  ".repeat(i)}- item ${i}`).join("\n");
    let out = "";
    expect(() => {
      out = html(src);
    }).not.toThrow();
    expect(out).toContain("item 0");
    expect(out).toContain("item 599");
    expect(count(out, "<ul")).toBeLessThanOrEqual(13);
  });
});

describe("markdown: adversarial input completes in linear time", () => {
  // Each of these took quadratic time before the patterns were fixed; a generous bound still
  // separates linear (a few ms) from quadratic (seconds) at these sizes.
  const BUDGET_MS = 1000;
  const cases: [string, string][] = [
    ["a run of unclosed [", "[".repeat(50_000)],
    ["a run of unclosed [a](", "[a](".repeat(20_000)],
    ["a link text with a run of [", `[${"[".repeat(50_000)}](x`],
    ["a heading with a long run of spaces", `# a${" ".repeat(50_000)}b`],
    ["a heading with spaces before an id", `## a${" ".repeat(50_000)}{#x`],
  ];
  for (const [what, src] of cases) {
    it(what, () => {
      expect(timed(() => html(src))).toBeLessThan(BUDGET_MS);
    });
  }
});

describe("markdown: normal documents", () => {
  it("renders headings with explicit, numbered and derived ids, and a table of contents", () => {
    const { nodes, toc } = renderDocument(
      "# Title\n\n## 3. Names {#names}\n\n### 9.1 HTTP overlay\n\n## Hello, World!\n",
      { skipTitle: true },
    );
    const out = renderToStaticMarkup(createElement(Fragment, null, ...nodes));
    expect(out).not.toContain("Title");
    expect(out).toContain('<h2 id="names" class="md-h">3. Names');
    expect(out).toContain('<h3 id="s9-1" class="md-h">9.1 HTTP overlay');
    expect(out).toContain('<h2 id="hello-world" class="md-h">');
    expect(toc).toEqual([
      { id: "names", text: "3. Names", level: 2 },
      { id: "s9-1", text: "9.1 HTTP overlay", level: 3 },
      { id: "hello-world", text: "Hello, World!", level: 2 },
    ]);
  });

  it("makes a rule definition a callout with an anchor, and links rule ids elsewhere", () => {
    const def = html("**[P-4.3]** A forwarder MUST recompute the args digest.", { defineRules: true });
    expect(def).toContain('<p class="md-rule" data-level="must">');
    expect(def).toContain('<a id="p-4-3" href="#p-4-3" class="md-rule-id">P-4.3</a>');
    expect(def).toContain('<strong class="md-kw">MUST</strong>');

    const ref = html("See [P-4.3].", { rulesHref: "" });
    expect(ref).toContain('<a href="#p-4-3" class="md-rule-ref">P-4.3</a>');
  });

  it("renders a table with a header row", () => {
    const out = html("| Key | What |\n|---|---|\n| `1` | open a window |\n| a \\| b | pipe |");
    expect(out).toContain('<div class="md-table"><table><thead><tr><th scope="col">Key</th>');
    expect(out).toContain("<td><code>1</code></td><td>open a window</td>");
    expect(out).toContain("<td>a | b</td>");
  });

  it("renders a code fence without inline markup inside it", () => {
    const out = html("```ts\nconst a = **b**; // [P-1.1]\n```\n\nAfter.");
    expect(out).toContain('data-lang="ts"');
    expect(out).toContain("const");
    expect(out).not.toContain("<strong>b</strong>");
    expect(out).not.toContain("md-rule");
    expect(out).toContain("<p>After.</p>");
  });
});
