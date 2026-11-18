import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { SectionNav } from "@/components/site/section-nav";
import { LocaleProvider } from "@/lib/i18n/client";
import { HTML_LANG } from "@/lib/i18n/locale";
import { chrome } from "@/lib/i18n/messages/chrome";
import { getLocale, getMessages } from "@/lib/i18n/server";
import "./globals.css";

/** Outfit: a geometric sans (true-circle bowls, single-storey a), in the register of Qurova. */
const sans = Outfit({ subsets: ["latin"], variable: "--font-sans-face", display: "swap" });
/** JetBrains Mono: names, digests and packets. */
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });

/** Site-wide title and description, in the visitor's language (pages set their own titles). */
export async function generateMetadata(): Promise<Metadata> {
  const t = (await getMessages(chrome)).meta;
  return {
    title: { default: t.title, template: "%s · IDEM" },
    description: t.description,
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

/** Resolve the theme before first paint: stored choice, else the system preference. */
const THEME_SCRIPT = `(function(){document.documentElement.classList.add("js");try{var p=localStorage.getItem("idem-theme");var l=window.matchMedia("(prefers-color-scheme: light)").matches;document.documentElement.dataset.theme=p==="light"||p==="dark"?p:(l?"light":"dark");}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={HTML_LANG[locale]}
      data-theme="dark"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <LocaleProvider locale={locale}>
          <SiteHeader />
          {/* The home page's section nav (renders on `/` only; finds sections by `data-nav-section`). */}
          <SectionNav />
          {children}
          <SiteFooter />
        </LocaleProvider>
      </body>
    </html>
  );
}
