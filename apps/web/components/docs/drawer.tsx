"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useMessages } from "@/lib/i18n/client";
import { docs } from "@/lib/i18n/messages/docs";
import { DocsNav, type NavGroup } from "./nav";

/**
 * The page tree on small screens: a bar under the header names the current page and opens the
 * tree as a drawer. The drawer is a native modal `<dialog>`, so focus stays inside it, Escape
 * closes it and the page behind is inert; it slides in on a spring and closes on navigation or
 * on a tap outside.
 */
export function DocsDrawer({ groups }: { groups: NavGroup[] }) {
  const t = useMessages(docs).nav;
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const group = groups.find((g) => g.items.some((it) => it.href === path));
  const current = group?.items.find((it) => it.href === path);

  // Arriving on a page closes the drawer that led there.
  useEffect(() => {
    dialog.current?.close();
  }, [path]);

  const close = () => dialog.current?.close();

  return (
    <>
      <div className="docs-bar">
        <button
          type="button"
          className="docs-bar-button"
          aria-haspopup="dialog"
          aria-label={t.open}
          onClick={() => dialog.current?.showModal()}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="docs-bar-icon">
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" />
          </svg>
          <span className="docs-bar-group">{group?.label ?? t.label}</span>
          {current && <span className="docs-bar-title">{current.title}</span>}
        </button>
      </div>
      <dialog
        ref={dialog}
        className="docs-drawer"
        aria-label={t.label}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="docs-drawer-panel">
          <div className="docs-drawer-head">
            <span>{t.label}</span>
            <button type="button" className="docs-drawer-close" aria-label={t.close} onClick={close}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          </div>
          <DocsNav groups={groups} label={t.label} onNavigate={close} />
        </div>
      </dialog>
    </>
  );
}
