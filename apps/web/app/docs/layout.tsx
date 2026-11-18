import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsDrawer } from "@/components/docs/drawer";
import { DocsNav, type NavGroup } from "@/components/docs/nav";
import { DOC_GROUPS, DOC_PAGES, docHref } from "@/components/docs/pages";
import { docs } from "@/lib/i18n/messages/docs";
import { getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages(docs);
  return {
    title: { default: t.meta.title, template: t.meta.titleTemplate },
    description: t.meta.description,
  };
}

/**
 * The documentation shell (spec 04 §4, ADR-022): the page tree on the left, the article in the
 * middle, and the page's own "on this page" rail on the right (rendered by each page). The shell
 * stays mounted while the visitor moves between pages, which is what lets the tree's indicator
 * glide from one page to the next.
 */
export default async function DocsLayout({ children }: { children: ReactNode }) {
  const t = await getMessages(docs);
  const groups: NavGroup[] = DOC_GROUPS.map((g) => ({
    label: t.groups[g],
    items: DOC_PAGES.filter((p) => p.group === g).map((p) => ({
      href: docHref(p.slug),
      title: t.pages[p.slug].title,
    })),
  }));
  return (
    <div className="docs-shell">
      <DocsDrawer groups={groups} />
      <aside className="docs-sidebar">
        <DocsNav groups={groups} label={t.nav.label} />
      </aside>
      {children}
    </div>
  );
}
