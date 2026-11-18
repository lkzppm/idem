import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { DocsPageView } from "@/components/docs/page-view";
import { findDoc } from "@/components/docs/pages";
import { docs } from "@/lib/i18n/messages/docs";
import { getMessages } from "@/lib/i18n/server";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ text?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findDoc((await params).slug);
  if (!page) return {};
  const t = await getMessages(docs);
  return { title: t.pages[page.slug].title, description: t.pages[page.slug].lead };
}

/**
 * `/docs/<slug>`: one documentation page. `?text=en` shows a normative page's own English text
 * where the visitor's language would otherwise get the translation (ADR-018, ADR-022).
 */
export default async function DocsSlugPage({ params, searchParams }: Props) {
  const { slug } = await params;
  // The introduction lives at /docs itself.
  if (slug === "introduction") permanentRedirect("/docs");
  const page = findDoc(slug);
  if (!page) notFound();
  const original = (await searchParams).text === "en";
  return <DocsPageView page={page} original={original} />;
}
