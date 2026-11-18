import { DocsPageView } from "@/components/docs/page-view";
import { DOC_PAGES } from "@/components/docs/pages";

/** `/docs`: the introduction, the first page of the documentation (spec 04 §4). */
export default function DocsIndexPage() {
  const page = DOC_PAGES[0];
  return page ? <DocsPageView page={page} /> : null;
}
