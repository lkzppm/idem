"use client";

import { usePathname } from "next/navigation";
import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useMessages } from "@/lib/i18n/client";
import { chrome } from "@/lib/i18n/messages/chrome";
import { gooTo } from "./goo";

/**
 * The contract with the pages: any element with `data-nav-section` and an `id` is a stop of this
 * nav, labelled by its `data-nav-label` (already in the page's language). Sections are read from
 * the DOM, in document order, so the nav follows whatever the page renders.
 */
const SELECTOR = "[data-nav-section][id]";

interface Section {
  id: string;
  label: string;
}

function same(a: Section[], b: Section[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i]?.id && s.label === b[i]?.label);
}

function readSections(): Section[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).map((el) => ({
    id: el.id,
    label: el.dataset.navLabel?.trim() || el.id,
  }));
}

/**
 * The section nav: a floating bar of glass under the header, shown once the hero has scrolled away.
 * Mounted by the root layout on the pages that opt in (`SECTION_NAV_PATHS`: the home page and
 * `/benchmarks`); renders nothing elsewhere. Each page only marks its sections.
 */
export function SectionNav() {
  const path = usePathname();
  if (!SECTION_NAV_PATHS.includes(path)) return null;
  // Keyed by route: a client navigation between two pages that both have the nav starts it afresh.
  return <SectionNavBar key={path} />;
}

/** The routes whose sections the nav follows. */
export const SECTION_NAV_PATHS: readonly string[] = ["/", "/benchmarks"];

/**
 * The bar itself. It finds the page's sections (re-reading on DOM changes), tracks the one being
 * read with an IntersectionObserver (a thin band a third of the way down the viewport), and jumps
 * smoothly to a section on click. The current section sits under a drop of ink (`goo.ts`) that
 * runs along the bar as you scroll. It drops in from under the header with a small overshoot and
 * leaves the same way when you scroll back to the hero. On a phone the bar spans the width and
 * scrolls sideways, keeping the current section in view.
 */
function SectionNavBar() {
  const t = useMessages(chrome).sectionNav;
  const reduced = useReducedMotion();
  const [sections, setSections] = useState<Section[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  /** The item with keyboard focus: its copy inside the drop shows the focus ring too. */
  const [focused, setFocused] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, HTMLAnchorElement>());
  /** While a click's smooth scroll runs, the clicked section stays current. */
  const lock = useRef<{ id: string; until: number } | null>(null);

  // Find the sections, and find them again whenever the page's DOM changes.
  useEffect(() => {
    let raf = 0;
    const scan = () => {
      raf = 0;
      const next = readSections();
      setSections((prev) => (same(prev, next) ? prev : next));
    };
    scan();
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(scan);
    });
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-nav-section", "data-nav-label", "id"],
    });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Which section is being read: the one crossing a thin band 38% down the viewport. At the very
  // bottom of the page the last section wins (it may be too short to ever reach the band).
  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const inBand = new Set<string>();
    const pick = () => {
      const l = lock.current;
      if (l && performance.now() < l.until) return;
      lock.current = null;
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const last = els[els.length - 1];
      if (atEnd && last) {
        setCurrent(last.id);
        return;
      }
      const first = els.find((el) => inBand.has(el.id));
      if (first) setCurrent(first.id);
      else if (els[0] && els[0].getBoundingClientRect().top > window.innerHeight * 0.38) setCurrent(null);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id);
          else inBand.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: "-38% 0px -61% 0px" },
    );
    for (const el of els) io.observe(el);
    let raf = 0;
    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          pick();
        });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [sections]);

  // Shown once the first section below the fold reaches the middle of the viewport, that is, once
  // the hero has mostly scrolled away; hidden again on the way back up.
  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) {
      setShown(false);
      return;
    }
    const fold = window.innerHeight * 0.5;
    const ref = els.find((el) => el.getBoundingClientRect().top + window.scrollY >= fold) ?? els[0];
    if (!ref) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        setShown(e.isIntersecting || e.boundingClientRect.top < 0);
      },
      { rootMargin: "0px 0px -50% 0px" },
    );
    io.observe(ref);
    return () => io.disconnect();
  }, [sections]);

  // The drop follows the current section; on a phone the bar scrolls to keep it in view.
  const place = useCallback(
    (instant: boolean) => {
      const d = drop.current;
      const tr = track.current;
      const sc = scroller.current;
      if (!d || !tr || !sc) return;
      const a = current ? items.current.get(current) : undefined;
      if (!a) {
        delete d.dataset.on;
        return;
      }
      const left = a.offsetLeft;
      const right = tr.offsetWidth - (a.offsetLeft + a.offsetWidth);
      gooTo(d, left, right, instant || d.dataset.on === undefined);
      d.dataset.on = "";
      if (sc.scrollWidth > sc.clientWidth + 1) {
        const target = a.offsetLeft + a.offsetWidth / 2 - sc.clientWidth / 2;
        sc.scrollTo({ left: Math.max(0, target), behavior: instant || reduced ? "instant" : "smooth" });
      }
    },
    [current, reduced],
  );

  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
    place(!shown);
  }, [place, shown]);

  // Re-place the drop, with no motion, when the labels change size (fonts, language).
  const hasSections = sections.length > 0;
  useEffect(() => {
    const tr = track.current;
    if (!hasSections || !tr) return;
    let width = tr.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (tr.offsetWidth === width) return;
      width = tr.offsetWidth;
      placeRef.current(true);
    });
    ro.observe(tr);
    return () => ro.disconnect();
  }, [hasSections]);

  const jump = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById(id);
    if (!el || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    // Land the section's heading, not its padded edge, by the bar (measured at its resting place,
    // whatever its transform right now). Where the label clears the bar sideways (the bar sits
    // centred on a desk), the label lines up with the bar; where they would overlap (a phone, where
    // the bar spans the width), the label lands just below it. Where the label clears it but
    // something beside the label would sit under the bar (a card in the next column), the whole
    // section lands below the bar, with room to breathe.
    const root = bar.current;
    const panel = root?.firstElementChild;
    const barTop = root ? root.offsetTop : 74;
    const barH = panel instanceof HTMLElement ? panel.offsetHeight : 44;
    const inner = el.firstElementChild;
    const pad = inner instanceof HTMLElement ? Number.parseFloat(getComputedStyle(inner).paddingTop) || 0 : 0;
    const contentTop = el.getBoundingClientRect().top + window.scrollY + pad;
    const label = el.querySelector<HTMLElement>(".eyebrow");
    let land = barTop + barH + 16;
    if (label && panel instanceof HTMLElement) {
      const l = label.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const clear = l.right + 16 <= p.left || l.left >= p.right + 16;
      // The bar's bottom edge, measured from the label's top once the label sits beside the bar.
      const barEnd = l.top + (barH + label.offsetHeight) / 2 + 4;
      if (clear && besideUnder(label, el, p, barEnd)) land = barTop + barH + 48;
      else if (clear) land = barTop + (barH - label.offsetHeight) / 2;
    }
    const top = Math.max(0, contentTop - land);
    lock.current = { id, until: performance.now() + (reduced ? 0 : 1200) };
    setCurrent(id);
    // Move keyboard focus with the reader first, without a scroll of its own.
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
    window.scrollTo({ top, behavior: reduced ? "instant" : "smooth" });
  };

  const toTop = () => {
    lock.current = null;
    window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
  };

  if (sections.length === 0) return null;

  return (
    <div ref={bar} className="section-nav" data-shown={shown ? "" : undefined} inert={!shown}>
      <nav aria-label={t.label} className="section-nav-bar material">
        <button type="button" onClick={toTop} aria-label={t.top} title={t.top} className="section-nav-top">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path
              d="M8 13V3.5M3.5 8 8 3.5 12.5 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span aria-hidden="true" className="section-nav-sep" />
        <div ref={scroller} className="section-nav-scroller">
          <div ref={track} className="section-nav-track">
            {sections.map((s) => (
              <a
                key={s.id}
                ref={(el) => {
                  if (el) items.current.set(s.id, el);
                  else items.current.delete(s.id);
                }}
                href={`#${s.id}`}
                onClick={jump(s.id)}
                onFocus={(e) => setFocused(e.currentTarget.matches(":focus-visible") ? s.id : null)}
                onBlur={() => setFocused(null)}
                aria-current={current === s.id ? "location" : undefined}
                className="section-nav-item"
              >
                {s.label}
              </a>
            ))}
            {/* The drop: ink with the labels again in the inverse colour, clipped to the current one. */}
            <div ref={drop} aria-hidden="true" className="section-nav-drop goo">
              {sections.map((s) => (
                <span key={s.id} className="section-nav-item" data-focus={focused === s.id ? "" : undefined}>
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}

/**
 * Whether a box beside the label (a sibling of the label or of one of its ancestors, up to the
 * section) spans the bar's columns and starts above `below` (page-relative to the label's row):
 * landed beside the bar, that box would sit under it.
 */
function besideUnder(label: HTMLElement, section: HTMLElement, bar: DOMRect, below: number): boolean {
  for (let node: HTMLElement | null = label; node && node !== section; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sib of parent.children) {
      if (sib === node || !(sib instanceof HTMLElement)) continue;
      const r = sib.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > bar.left && r.left < bar.right && r.top < below) return true;
    }
  }
  return false;
}
