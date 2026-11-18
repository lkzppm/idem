"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef } from "react";
import { useGlide } from "./use-glide";

/** One group of the page tree, already in the visitor's language. */
export interface NavGroup {
  label: string;
  items: { href: string; title: string }[];
}

/**
 * The docs' page tree. The current page is marked by one plate that glides from item to item when
 * the page changes (it stretches toward the new item and settles with a small bounce), and by a
 * blue square that pops in on arrival: blue is the request, and the page is what was asked for.
 * Without scripts the current link carries the same look, statically.
 */
export function DocsNav({
  groups,
  label,
  onNavigate,
}: {
  groups: NavGroup[];
  label: string;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const list = useRef<HTMLDivElement>(null);
  const glide = useGlide(list, '[aria-current="page"]', path);
  const id = useId();

  return (
    <nav aria-label={label} className="docs-nav">
      <div ref={list} className="docs-nav-list" data-glide={glide.ready && glide.visible ? "" : undefined}>
        <span
          aria-hidden="true"
          className="docs-glide docs-nav-glide"
          data-dir={glide.dir}
          data-ready={glide.ready ? "" : undefined}
          style={{ top: glide.top, bottom: glide.bottom, opacity: glide.visible ? 1 : 0 }}
        >
          {/* Re-mounted per page so the square pops each time it lands. */}
          <i key={path} className="docs-nav-dot" />
        </span>
        {groups.map((g, gi) => (
          <div key={g.label} className="docs-nav-group">
            <p id={`${id}-${gi}`} className="docs-nav-label">
              {g.label}
            </p>
            <ul aria-labelledby={`${id}-${gi}`}>
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    aria-current={path === it.href ? "page" : undefined}
                    {...(onNavigate && { onClick: onNavigate })}
                  >
                    {it.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
