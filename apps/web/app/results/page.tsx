import type { Metadata } from "next";
import { ResultsView } from "@/components/results/view";
import { results } from "@/lib/i18n/messages/results";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages(results);
  return { title: t.meta.title, description: t.meta.description };
}

/**
 * `/results`: the experiments that have run (E1, E2, E5), drawn from the committed run folders
 * through `lib/results/data.json` (spec 04 §1, spec 05 §5). No number is typed into this page.
 */
export default async function ResultsPage() {
  const locale = await getLocale();
  return <ResultsView locale={locale} t={results[locale]} />;
}
