import Link from "next/link";
import { chrome } from "@/lib/i18n/messages/chrome";
import { getMessages } from "@/lib/i18n/server";
import { HideOn } from "./hide-on";
import { Logo } from "./logo";

const AUTHOR = {
  name: "Lucas Pacheco",
  portfolio: "https://lkzppm.vercel.app",
  github: "https://github.com/lkzppm",
  linkedin: "https://www.linkedin.com/in/lucasppmc/",
};

/** Rows of the halftone band, top to bottom: dot radius on a 12 px staggered grid. */
const DOT_ROWS = [2.3, 1.8, 1.3, 0.8];
const DOT_STEP = 12;

/**
 * A strip of halftone where the page meets the footer: flat dots on a staggered grid, shrinking
 * row by row, the same print the hero's backdrop and the globe's territories are made of.
 */
function HalftoneBand() {
  const h = DOT_ROWS.length * DOT_STEP;
  return (
    <svg aria-hidden="true" className="footer-dots" width="100%" height={h}>
      <defs>
        {DOT_ROWS.map((r, i) => (
          <pattern
            key={i}
            id={`footer-dots-${i}`}
            width={DOT_STEP}
            height={DOT_STEP}
            patternUnits="userSpaceOnUse"
            x={i % 2 ? DOT_STEP / 2 : 0}
            y={i * DOT_STEP}
          >
            <circle cx={DOT_STEP / 2} cy={DOT_STEP / 2} r={r} />
          </pattern>
        ))}
      </defs>
      {DOT_ROWS.map((_, i) => (
        <rect key={i} x="0" y={i * DOT_STEP} width="100%" height={DOT_STEP} fill={`url(#footer-dots-${i})`} />
      ))}
    </svg>
  );
}

/** A window with a cursor: a personal site. */
function PortfolioIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 5.5h13" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="3.6" cy="4" r="0.6" fill="currentColor" />
      <circle cx="5.4" cy="4" r="0.6" fill="currentColor" />
      <path
        d="M7 8l4 1.6-1.7.6-.6 1.7L7 8Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor">
      <path d="M13.63 0H2.37A2.37 2.37 0 0 0 0 2.37v11.26A2.37 2.37 0 0 0 2.37 16h11.26A2.37 2.37 0 0 0 16 13.63V2.37A2.37 2.37 0 0 0 13.63 0ZM4.92 13.27H2.6V6.13h2.32v7.14ZM3.76 5.15a1.34 1.34 0 1 1 0-2.68 1.34 1.34 0 0 1 0 2.68Zm9.51 8.12h-2.32V9.8c0-.83-.02-1.9-1.16-1.9-1.16 0-1.34.9-1.34 1.84v3.53H6.13V6.13h2.22v.97h.03c.31-.59 1.07-1.21 2.2-1.21 2.35 0 2.78 1.55 2.78 3.56v3.82Z" />
    </svg>
  );
}

function OutArrow() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" className="footer-out" fill="none">
      <path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Site footer, in the cartoon register: a halftone band instead of a rule, the logo and the
 * thesis, the site's pages, the author with his links, and the course line. States no numbers.
 * Hidden on `/sandbox`, which is a full-viewport workspace.
 */
export async function SiteFooter() {
  const m = await getMessages(chrome);
  const t = m.footer;
  const pages = [
    { href: "/", label: t.links.home },
    { href: "/sandbox", label: t.links.sandbox },
    { href: "/docs", label: t.links.docs },
    { href: "/results", label: t.links.results },
    { href: "/brand", label: t.links.brand },
  ];
  const profiles = [
    { href: AUTHOR.portfolio, label: t.portfolio, icon: <PortfolioIcon /> },
    { href: AUTHOR.github, label: "GitHub", icon: <GitHubIcon /> },
    { href: AUTHOR.linkedin, label: "LinkedIn", icon: <LinkedInIcon /> },
  ];
  return (
    <HideOn routes={["/sandbox"]}>
      <footer className="site-footer">
        <HalftoneBand />
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="footer-grid">
            <div className="flex max-w-sm flex-col gap-4">
              <Link href="/" aria-label={m.header.home} className="logo-link w-fit text-fg">
                <Logo />
              </Link>
              <p className="text-sm leading-relaxed text-muted text-pretty">{t.thesis}</p>
            </div>
            <nav aria-labelledby="footer-site">
              <p id="footer-site" className="footer-head">
                {t.site}
              </p>
              <ul className="footer-list">
                {pages.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="footer-link">
                      <span>{p.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <section aria-labelledby="footer-author">
              <p id="footer-author" className="footer-head">
                {t.author}
              </p>
              <p className="mt-3 text-sm text-fg">{AUTHOR.name}</p>
              <ul className="footer-list">
                {profiles.map((p) => (
                  <li key={p.href}>
                    <a href={p.href} target="_blank" rel="noopener noreferrer" className="footer-profile">
                      <span className="footer-profile-icon">{p.icon}</span>
                      <span>{p.label}</span>
                      <OutArrow />
                      <span className="sr-only">({t.newTab})</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="footer-base">
            <p>
              {t.prototype} <span aria-hidden="true">·</span> {t.course} <span aria-hidden="true">·</span>{" "}
              {t.school} <span aria-hidden="true">·</span> {t.term}
            </p>
            <p className="t-mono">/idem/v1</p>
          </div>
        </div>
      </footer>
    </HideOn>
  );
}
