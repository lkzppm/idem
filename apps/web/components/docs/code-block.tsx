"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { docs } from "@/lib/i18n/messages/docs";

/**
 * A code block: monospace, scrolls sideways instead of wrapping, and copies its source with one
 * click. The button answers with a small pop and a check; the announcement is for screen readers.
 */
export function CodeBlock({ code, lang, children }: { code: string; lang: string; children: ReactNode }) {
  const t = useMessages(docs).code;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return; // clipboard unavailable (insecure context): leave the button as it was
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="md-code" data-lang={lang || undefined}>
      {lang && <span className="md-code-lang">{lang}</span>}
      <button
        type="button"
        className="md-copy"
        data-copied={copied || undefined}
        onClick={() => void copy()}
        aria-label={copied ? t.copied : t.copy}
        title={copied ? t.copied : t.copy}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <g className="md-copy-idle">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
            <path d="M10.5 3.5v-.4a1.6 1.6 0 0 0-1.6-1.6H4.1a1.6 1.6 0 0 0-1.6 1.6v4.8a1.6 1.6 0 0 0 1.6 1.6h.4" />
          </g>
          <path className="md-copy-done" d="M3.2 8.4l3 3 6.6-6.8" />
        </svg>
      </button>
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
      <span className="sr-only" aria-live="polite">
        {copied ? t.copied : ""}
      </span>
    </div>
  );
}
