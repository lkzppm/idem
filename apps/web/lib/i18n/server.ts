import { cookies, headers } from "next/headers";
import { cache } from "react";
import { isLocale, LOCALE_COOKIE, type Locale, localeFromAcceptLanguage, type Messages } from "./locale";

/**
 * The visitor's locale for this request (server components): their saved choice, else the first
 * language their browser asks for that the site speaks, else English.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
});

/** An area's dictionary in the request's locale: `const t = await getMessages(landing)`. */
export async function getMessages<T>(m: Messages<T>): Promise<T> {
  return m[await getLocale()];
}
