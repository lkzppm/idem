import Link from "next/link";
import type { ReactNode } from "react";
import { chrome } from "@/lib/i18n/messages/chrome";
import { getMessages } from "@/lib/i18n/server";

/** A page that exists but has nothing to show yet. States so plainly; shows no numbers. */
export async function Placeholder({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  const t = (await getMessages(chrome)).placeholder;
  return (
    <main className="bg-grid relative">
      <div className="mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center px-4 py-24 sm:px-6">
        <p className="t-eyebrow mb-4">{eyebrow}</p>
        <h1 className="t-h2 text-balance">{title}</h1>
        <div className="mt-6 flex flex-col gap-4 text-[17px] leading-relaxed text-muted">{children}</div>
        <div className="mt-10 flex gap-3">
          <Link href="/sandbox" className="btn btn-primary">
            {t.sandbox}
          </Link>
          <Link href="/docs" className="btn btn-data">
            {t.docs}
          </Link>
        </div>
      </div>
    </main>
  );
}
