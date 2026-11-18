"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useTransition } from "react";
import { DEFAULT_LOCALE, HTML_LANG, LOCALE_COOKIE, type Locale, type Messages } from "./locale";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Hands the request's locale (read on the server, `getLocale`) to client components. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The current locale (client components). */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** An area's dictionary in the current locale: `const t = useMessages(sandbox)`. */
export function useMessages<T>(m: Messages<T>): T {
  return m[useContext(LocaleContext)];
}

/**
 * Switch language: saves the choice in a cookie (a year) and re-renders the page on the server in
 * the new language, keeping client state (scroll, open windows) where React can.
 */
export function useSetLocale(): { setLocale: (next: Locale) => void; pending: boolean } {
  const router = useRouter();
  const [pending, start] = useTransition();
  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = HTML_LANG[next];
      start(() => router.refresh());
    },
    [router],
  );
  return { setLocale, pending };
}
