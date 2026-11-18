/**
 * Interface languages. The site reads in English or Portuguese; code, comments, the spec and the
 * normative docs stay in English (CLAUDE.md), and only what the visitor reads is translated.
 *
 * Strings live in small per-area dictionaries (`lib/i18n/messages/<area>.ts`), never inline in a
 * component: `en` is the schema and `pt` must match it key for key, so a missing translation is a
 * type error instead of a blank on the page.
 *
 * ```ts
 * export const hero = defineMessages(
 *   { title: "Tool calls as named data", count: (n: number) => `${n} nodes` },
 *   { title: "Chamadas de ferramenta como dados nomeados", count: (n: number) => `${n} nós` },
 * );
 * // server component: const t = hero[await getLocale()];
 * // client component: const t = hero[useLocale()];
 * ```
 */
export type Locale = "en" | "pt";

/** Every interface language, in the order the switch shows them. */
export const LOCALES: readonly Locale[] = ["en", "pt"];
/** The language when neither the cookie nor `Accept-Language` names one the site speaks. */
export const DEFAULT_LOCALE: Locale = "en";
/** The visitor's choice, readable on the server so pages render in it with no flash. */
export const LOCALE_COOKIE = "idem-locale";

/** The `lang` attribute for each locale. */
export const HTML_LANG: Record<Locale, string> = { en: "en", pt: "pt-BR" };

/** True when `value` is a locale the site speaks (e.g. a cookie value). */
export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "pt";
}

/** One dictionary per locale; every locale has the same shape as `en`. */
export type Messages<T> = Readonly<Record<Locale, T>>;

/**
 * Declare an area's strings: `en` defines the shape, `pt` must match it exactly. Values may be
 * strings, arrays, nested objects or functions (for sentences that take values, so each language
 * keeps its own word order).
 */
export function defineMessages<T>(en: T, pt: NoInfer<T>): Messages<T> {
  return { en, pt };
}

/**
 * The locale for an `Accept-Language` header: the first listed language (by weight) that the site
 * speaks, else the default.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
