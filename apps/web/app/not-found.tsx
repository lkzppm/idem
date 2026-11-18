import { Placeholder } from "@/components/site/placeholder";
import { notFound } from "@/lib/i18n/messages/not-found";
import { getMessages } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getMessages(notFound);
  return (
    <Placeholder eyebrow="404" title={t.title}>
      <p>{t.body}</p>
    </Placeholder>
  );
}
