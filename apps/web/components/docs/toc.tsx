"use client";

import { useEffect, useRef, useState } from "react";
import type { TocEntry } from "@/lib/markdown";
import { useGlide } from "./use-glide";

/** Headings count as "in view" once they pass this far below the sticky header. */
const READING_LINE = 112;

/**
 * "On this page": the headings of the article, with a marker that follows the one being read. The
 * marker rides a dashed rail and is yellow, the answer's color: it shows where you are in what
 * came back. Tracking is one passive scroll listener, throttled to a frame.
 */
export function DocsToc({ entries, title }: { entries: TocEntry[]; title: string }) {
  const [active, setActive] = useState<string | undefined>(entries[0]?.id);
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const glide = useGlide(list, "[data-active]", active);
  const ids = entries.map((e) => e.id).join("\n");

  useEffect(() => {
    const headings = ids
      .split("\n")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = headings[0];
      for (const h of headings) {
        if (h.getBoundingClientRect().top > READING_LINE) break;
        current = h;
      }
      // At the very end of the page the last heading may never reach the reading line.
      const page = document.documentElement;
      if (window.innerHeight + window.scrollY >= page.scrollHeight - 2) current = headings.at(-1);
      setActive(current?.id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ids]);

  // Keep the active entry visible when the list itself scrolls (long pages).
  useEffect(() => {
    const box = scroller.current;
    const item = list.current?.querySelector<HTMLElement>("[data-active]");
    if (!box || !item || box.scrollHeight <= box.clientHeight) return;
    const b = box.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    if (r.top < b.top + 40) box.scrollTop -= b.top + 40 - r.top;
    else if (r.bottom > b.bottom - 40) box.scrollTop += r.bottom - (b.bottom - 40);
  }, [active]);

  if (entries.length < 2) return null;

  return (
    <nav ref={scroller} aria-label={title} className="docs-toc">
      <p className="docs-toc-title">{title}</p>
      <div ref={list} className="docs-toc-list">
        <span
          aria-hidden="true"
          className="docs-glide docs-toc-glide"
          data-dir={glide.dir}
          data-ready={glide.ready ? "" : undefined}
          style={{ top: glide.top, bottom: glide.bottom, opacity: glide.visible ? 1 : 0 }}
        />
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <a
                href={`#${e.id}`}
                data-level={e.level}
                data-active={e.id === active ? "" : undefined}
                aria-current={e.id === active ? "location" : undefined}
              >
                {e.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
