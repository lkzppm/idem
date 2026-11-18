"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type PointerEvent, useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useMessages } from "@/lib/i18n/client";
import { chrome } from "@/lib/i18n/messages/chrome";
import { gooTo } from "./goo";
import { Logo } from "./logo";
import { type StoryTab, TabStory } from "./tab-story";

const TABS = [
  { href: "/sandbox", key: "sandbox" },
  { href: "/docs", key: "docs" },
  { href: "/benchmarks", key: "results" },
] as const;

/** The tab a pathname belongs to; `null` for home and for pages outside the tabs. */
export function tabOf(path: string): number | null {
  const i = TABS.findIndex((t) => path === t.href || path.startsWith(`${t.href}/`));
  return i < 0 ? null : i;
}

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * The logo and the main tabs, and the stage the tab story plays on (`tab-story.ts`): when the
 * active tab changes, by a click here or by any other navigation, an Interest leaves the mark for
 * the new tab, lands as its underline, and a Data comes back to the mark once the page is there.
 *
 * Hover: a soft drop of ink slides between the links (`goo.ts`), stretching toward the link under
 * the pointer and settling with a small bounce; it pops in where the pointer enters and fades where
 * it leaves. Keyboard focus shows the same drop.
 */
export function NavLinks() {
  const t = useMessages(chrome).header;
  const path = usePathname();
  const active = tabOf(path);
  const reduced = useReducedMotion();
  const first = useRef(active);
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLSpanElement>(null);
  const underline = useRef<HTMLSpanElement>(null);
  const nav = useRef<HTMLElement>(null);
  const hover = useRef<HTMLSpanElement>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const story = useRef<TabStory | null>(null);

  useEffect(() => {
    const s = stage.current;
    const l = layer.current;
    const u = underline.current;
    const n = nav.current;
    const mark = s?.querySelector<HTMLElement>(".mark-split");
    if (!s || !l || !u || !n || !mark) return;
    const tabs = (): StoryTab[] => {
      const out: StoryTab[] = [];
      TABS.forEach((_, i) => {
        const link = links.current[i];
        const label = labels.current[i];
        if (link && label) out.push({ link, label });
      });
      return out;
    };
    const st = new TabStory({ stage: s, layer: l, mark, underline: u, tabs }, matchMedia(REDUCED).matches);
    story.current = st;
    st.place(first.current);
    n.dataset.story = "";
    const relayout = () => st.relayout();
    const ro = new ResizeObserver(relayout);
    ro.observe(s);
    for (const a of links.current) if (a) ro.observe(a);
    void document.fonts?.ready.then(relayout);
    return () => {
      ro.disconnect();
      st.destroy();
      story.current = null;
      delete n.dataset.story;
    };
  }, []);

  // Any navigation, not only the clicks below (the logo, links in the page, back and forward).
  useEffect(() => {
    story.current?.arrive(active);
  }, [active]);

  useEffect(() => {
    story.current?.setReduced(reduced);
  }, [reduced]);

  const hoverTo = (i: number) => {
    const h = hover.current;
    const n = nav.current;
    const a = links.current[i];
    if (!h || !n || !a) return;
    const nr = n.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const left = ar.left - nr.left + 2;
    const right = nr.right - ar.right + 2;
    const showing = h.dataset.show !== undefined;
    gooTo(h, left, right, !showing);
    if (!showing) h.style.transformOrigin = `${left + ar.width / 2 - 2}px 50%`;
    h.dataset.show = "";
  };
  const hoverOut = () => {
    if (hover.current) delete hover.current.dataset.show;
  };
  const onEnter = (i: number) => (e: PointerEvent) => {
    // A tap has no hover: the drop would stay stuck on the tapped link.
    if (e.pointerType !== "touch") hoverTo(i);
  };

  return (
    <div ref={stage} className="tab-stage relative flex h-full min-w-0 items-center gap-2 sm:gap-7">
      <Link
        href="/"
        aria-label={t.home}
        onNavigate={() => story.current?.go(null)}
        className="logo-link flex h-full shrink-0 items-center"
      >
        <Logo />
      </Link>
      <nav
        ref={nav}
        aria-label={t.nav}
        className="nav-tabs relative flex h-full min-w-0 items-center"
        onPointerLeave={hoverOut}
      >
        <span ref={hover} aria-hidden="true" className="nav-hover goo" />
        {TABS.map((tab, i) => (
          <Link
            key={tab.href}
            ref={(el) => {
              links.current[i] = el;
            }}
            href={tab.href}
            aria-current={i === active ? "page" : undefined}
            onNavigate={() => story.current?.go(i)}
            onPointerEnter={onEnter(i)}
            onFocus={() => hoverTo(i)}
            onBlur={hoverOut}
            className="nav-tab"
          >
            <span
              ref={(el) => {
                labels.current[i] = el;
              }}
              className="nav-tab-label"
            >
              {t.tabs[tab.key]}
            </span>
          </Link>
        ))}
      </nav>
      <span ref={layer} aria-hidden="true" className="tab-layer">
        <span ref={underline} className="tab-underline" />
      </span>
    </div>
  );
}
