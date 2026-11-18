import Link from "next/link";
import { landing } from "@/lib/i18n/messages/landing";
import { getMessages } from "@/lib/i18n/server";
import { GlobeField } from "./globe-field";
import { HalftoneField } from "./halftone-field";
import { Arrow } from "./icons";
import { StackRow } from "./stack";

/**
 * One viewport: the halftone behind, half a living globe on the right, a few words on the left.
 * The section slides up under the translucent header (`-mt-16`, padded back down), so the
 * background and the globe use the whole viewport and show blurred through the header.
 */
export async function Hero() {
  const t = (await getMessages(landing)).hero;
  return (
    <section className="relative -mt-16 flex min-h-svh touch-pan-y flex-col overflow-hidden pt-16">
      <HalftoneField />
      <GlobeField />
      <div className="pointer-events-none relative mx-auto flex w-full max-w-6xl flex-1 items-start px-4 pt-16 pb-24 sm:px-6 md:items-center md:py-20">
        <div className="pointer-events-auto max-w-xl">
          <h1 className="animate-[enter_0.8s_var(--ease)_0.05s_backwards] font-display text-[clamp(44px,6.6vw,80px)] leading-[1.02] font-semibold tracking-[-0.04em]">
            {t.title.map((s) => (
              <span key={s.text}>
                {s.tone ? (
                  <span className={s.tone === "i" ? "text-interest" : "text-data-bright"}>{s.text}</span>
                ) : (
                  s.text
                )}
                {s.br && <br />}
              </span>
            ))}
          </h1>
          <p className="mt-6 max-w-md animate-[enter_0.8s_var(--ease)_0.14s_backwards] text-[17px] leading-relaxed text-muted sm:text-lg">
            {t.body}
          </p>
          <div className="mt-9 flex animate-[enter_0.8s_var(--ease)_0.22s_backwards] flex-wrap gap-3">
            <Link href="/sandbox" className="btn btn-primary">
              {t.sandbox}
              <Arrow className="btn-arrow" />
            </Link>
            <Link href="/docs" className="btn btn-data">
              {t.docs}
            </Link>
          </div>
          <div className="mt-10 animate-[enter_0.8s_var(--ease)_0.3s_backwards]">
            <StackRow label={t.stackLabel} titles={t.stack} />
          </div>
        </div>
      </div>
    </section>
  );
}
