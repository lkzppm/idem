import type { Metadata } from "next";
import { Sandbox } from "@/components/sandbox/sandbox";
import { sandbox } from "@/lib/i18n/messages/sandbox";
import { getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages(sandbox);
  return { title: t.meta.title, description: t.meta.description };
}

/** The sandbox: a full-viewport observatory under the site header (spec 04 §2, ADR-021). */
export default async function SandboxPage() {
  const t = await getMessages(sandbox);
  return (
    <main className="obs-main">
      <h1 className="sr-only">{t.meta.heading}</h1>
      <Sandbox />
    </main>
  );
}
