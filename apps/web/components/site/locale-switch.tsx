"use client";

import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useMessages, useSetLocale } from "@/lib/i18n/client";
import { HTML_LANG, LOCALES, type Locale } from "@/lib/i18n/locale";
import { chrome } from "@/lib/i18n/messages/chrome";
import { gooTo } from "./goo";

/**
 * Each language is named in itself, whatever the page's language (the usual picker convention). The
 * accessible name starts with the visible code ("EN, English") so that speech users can say what they
 * see (WCAG 2.5.3, label in name).
 */
const ENDONYM: Record<Locale, string> = { en: "English", pt: "Português" };

/**
 * The pt / en switch: a radio group of two, in the header next to the theme toggle. The chosen
 * language sits under a drop of ink that runs to the other side when the choice changes (`goo.ts`),
 * stretching ahead and landing with a small bounce; the labels inside the drop are drawn in the
 * inverse colour, so each one changes colour exactly as the edge passes it.
 *
 * Keyboard: one tab stop (the checked option); the arrow keys, Home and End move the choice, as in
 * any radio group. The choice is saved and the page re-renders on the server in the new language
 * (`useSetLocale`); the drop moves at once, without waiting for the new page.
 */
export function LocaleSwitch() {
  const locale = useLocale();
  const t = useMessages(chrome).language;
  const { setLocale, pending } = useSetLocale();
  const [choice, setChoice] = useState<Locale>(locale);
  const drop = useRef<HTMLSpanElement>(null);
  const options = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});
  const placed = useRef(false);

  // Follow the locale the server rendered (after the refresh, or a change made in another tab).
  useEffect(() => {
    setChoice(locale);
  }, [locale]);

  useLayoutEffect(() => {
    const d = drop.current;
    if (!d) return;
    const w = d.clientWidth;
    const half = w / 2;
    const i = LOCALES.indexOf(choice);
    gooTo(d, i * half, (LOCALES.length - 1 - i) * half, !placed.current);
    placed.current = true;
  }, [choice]);

  const pick = (next: Locale, focus = false) => {
    if (focus) options.current[next]?.focus();
    if (next === choice) return;
    setChoice(next);
    setLocale(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = LOCALES.indexOf(choice);
    const last = LOCALES.length - 1;
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? i === last
          ? 0
          : i + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? i === 0
            ? last
            : i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    const next = LOCALES[to];
    if (!next) return;
    e.preventDefault();
    pick(next, true);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t.label}
      aria-busy={pending || undefined}
      title={pending ? t.switching : undefined}
      onKeyDown={onKeyDown}
      className="locale-switch"
      data-pending={pending ? "" : undefined}
    >
      <span ref={drop} aria-hidden="true" className="locale-drop goo">
        {LOCALES.map((l) => (
          <span key={l}>{l.toUpperCase()}</span>
        ))}
      </span>
      {LOCALES.map((l) => (
        <button
          key={l}
          ref={(el) => {
            options.current[l] = el;
          }}
          type="button"
          role="radio"
          aria-checked={choice === l}
          aria-label={`${l.toUpperCase()}, ${ENDONYM[l]}`}
          lang={HTML_LANG[l]}
          tabIndex={choice === l ? 0 : -1}
          onClick={() => pick(l)}
          className="locale-option"
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
