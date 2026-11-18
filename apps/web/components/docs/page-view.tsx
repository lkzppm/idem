import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { docs } from "@/lib/i18n/messages/docs";
import { getLocale } from "@/lib/i18n/server";
import { renderDocument } from "@/lib/markdown";
import { type LoadedDoc, loadDoc, referenceKeys } from "./content";
import { DocsFigure, DocsFigureDefs, isFigureName } from "./figures";
import { type DocPage, docHref, neighbours } from "./pages";
import { DocsToc } from "./toc";

type Strings = (typeof docs)["en"];

/**
 * Where the text on the page comes from, said plainly above it: a spec file rendered as is, a
 * translation (with the normative text one click away), or a page shown in English for now.
 */
function SourceNote({
  page,
  loaded,
  original,
  locale,
  t,
}: {
  page: DocPage;
  loaded: LoadedDoc | undefined;
  original: boolean;
  locale: Locale;
  t: Strings["source"];
}) {
  const file = page.spec ? `spec/${page.spec}` : undefined;
  if (!loaded) {
    return (
      <aside className="docs-note" data-tone="warn">
        <p>
          {t.missing} <code>{file ?? `apps/web/content/docs/en/${page.slug}.md`}</code>
        </p>
      </aside>
    );
  }
  if (loaded.kind === "translation") {
    return (
      <aside className="docs-note">
        <p>
          {t.translation}{" "}
          <Link href={`${docHref(page.slug)}?text=en`} className="docs-note-link">
            {t.readOriginal}
          </Link>
        </p>
        {loaded.stale && <p className="docs-note-warn">{t.stale}</p>}
      </aside>
    );
  }
  if (loaded.kind === "fallback") {
    return (
      <aside className="docs-note">
        <p>{t.fallback}</p>
      </aside>
    );
  }
  if (loaded.kind !== "spec") return null;
  // A spec file, as written. In English that is simply the source. In another language the note
  // also leads back to the translation, or says why the page has none.
  const source = (
    <p>
      {t.renderedFrom} <code>{file}</code> {t.asIs} {page.normative ? t.normative : null}
    </p>
  );
  if (locale === "en") return <aside className="docs-note">{source}</aside>;
  return (
    <aside className="docs-note">
      {original && page.translated ? (
        <p>
          {t.original}{" "}
          <Link href={docHref(page.slug)} className="docs-note-link">
            {t.readTranslation}
          </Link>
        </p>
      ) : (
        <p>{t.untranslated[page.slug as keyof Strings["source"]["untranslated"]]}</p>
      )}
      {source}
    </aside>
  );
}

function Pager({ page, t }: { page: DocPage; t: Strings }) {
  const { previous, next } = neighbours(page.slug);
  if (!previous && !next) return null;
  return (
    <nav aria-label={t.pager.label} className="docs-pager">
      {previous ? (
        <Link href={docHref(previous.slug)} rel="prev" className="docs-pager-link" data-dir="previous">
          <span className="docs-pager-dir">{t.pager.previous}</span>
          <span className="docs-pager-title">
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d="M9.5 3.5L5 8l4.5 4.5" />
            </svg>
            {t.pages[previous.slug].title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={docHref(next.slug)} rel="next" className="docs-pager-link" data-dir="next">
          <span className="docs-pager-dir">{t.pager.next}</span>
          <span className="docs-pager-title">
            {t.pages[next.slug].title}
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d="M6.5 3.5L11 8l-4.5 4.5" />
            </svg>
          </span>
        </Link>
      )}
    </nav>
  );
}

/**
 * One documentation page: header, a note on where the text comes from, the article, the previous
 * and next links, and the "on this page" rail. `original` shows a spec file's own (English) text
 * where a translation would otherwise be shown.
 */
export async function DocsPageView({ page, original = false }: { page: DocPage; original?: boolean }) {
  const locale = await getLocale();
  const t = docs[locale];
  const [loaded, refs] = await Promise.all([loadDoc(page, locale, { original }), referenceKeys()]);
  const figure = (name: string, arg: string, text: string): ReactNode =>
    name === "figure" && isFigureName(arg) ? <DocsFigure name={arg} caption={text} strings={t.fig} /> : null;
  const doc = loaded
    ? renderDocument(loaded.markdown, {
        skipTitle: Boolean(page.spec),
        rulesHref: page.slug === "protocol" ? "" : docHref("protocol"),
        adrsHref: page.slug === "decisions" ? "" : docHref("decisions"),
        refsHref: page.slug === "references" ? "" : docHref("references"),
        refs,
        defineRules: page.slug === "protocol",
        defineRefs: page.slug === "references",
        linkSections: page.slug === "protocol",
        anchorLabel: t.anchor,
        directive: figure,
      })
    : undefined;
  const toc = doc?.toc ?? [];
  const meta = t.pages[page.slug];

  return (
    <>
      <main className="docs-main">
        <article className="docs-article">
          <header className="docs-header">
            <p className="docs-kicker">{t.groups[page.group]}</p>
            <h1>{meta.title}</h1>
            <p className="docs-lead">{meta.lead}</p>
          </header>
          <SourceNote page={page} loaded={loaded} original={original} locale={locale} t={t.source} />
          {toc.length > 1 && (
            <details className="docs-toc-inline">
              <summary>{t.toc.title}</summary>
              <ul>
                {toc.map((e) => (
                  <li key={e.id} data-level={e.level}>
                    <a href={`#${e.id}`}>{e.text}</a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <DocsFigureDefs />
          <div className="docs-prose">{doc?.nodes}</div>
          <Pager page={page} t={t} />
        </article>
      </main>
      <aside className="docs-toc-rail">
        <DocsToc entries={toc} title={t.toc.title} />
      </aside>
    </>
  );
}
