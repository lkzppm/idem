import type { ReactNode } from "react";

/**
 * A very small syntax highlighter for the docs' code blocks. It only separates what a reader
 * skims past (comments), what is literal (strings, numbers) and what is structure (keywords);
 * everything else keeps the ink color. No hues: blue and yellow mean Interest and Data on this
 * site, and code must not dilute that.
 */

type Kind = "c" | "s" | "k" | "n";

const TS_KEYWORDS =
  "abstract|as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|keyof|let|new|null|of|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield";

const GRAMMARS: Record<string, RegExp> = {
  ts: new RegExp(
    [
      "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)",
      "(\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)",
      `(\\b(?:${TS_KEYWORDS})\\b)`,
      "(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)",
    ].join("|"),
    "g",
  ),
  // Every grammar has the same four groups (comment, string, keyword, number); `((?!))` never matches.
  json: /((?!))|("(?:[^"\\\n]|\\.)*")|(\b(?:true|false|null)\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g,
  sh: /((?<=^|\s)#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'[^'\n]*')|((?!))|((?!))/gm,
};

const ALIASES: Record<string, string> = {
  ts: "ts",
  tsx: "ts",
  js: "ts",
  jsx: "ts",
  typescript: "ts",
  javascript: "ts",
  json: "json",
  sh: "sh",
  bash: "sh",
  shell: "sh",
};

const KINDS: Kind[] = ["c", "s", "k", "n"];

/** Split `code` into plain text and marked spans (`.tok-c`, `.tok-s`, `.tok-k`, `.tok-n`). */
export function highlight(code: string, lang: string): ReactNode[] {
  const shared = GRAMMARS[ALIASES[lang.toLowerCase()] ?? ""];
  if (!shared) return [code];
  // A regex of its own per call, like the Markdown renderer: no `lastIndex` shared between calls.
  const grammar = new RegExp(shared.source, shared.flags);
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (let m = grammar.exec(code); m; m = grammar.exec(code)) {
    if (m[0].length === 0) {
      grammar.lastIndex++;
      continue;
    }
    const kind = KINDS[m.slice(1).findIndex((g) => g !== undefined)] ?? "s";
    if (m.index > last) out.push(code.slice(last, m.index));
    out.push(
      <span key={n++} className={`tok-${kind}`}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
