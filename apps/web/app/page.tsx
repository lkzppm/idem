import Link from "next/link";
import type { ReactNode } from "react";
import { Sorter } from "@/components/landing/figures/sorter";
import { StackFigure } from "@/components/landing/figures/stack";
import { Swarm } from "@/components/landing/figures/swarm";
import { Vignette } from "@/components/landing/figures/vignettes";
import { Hero } from "@/components/landing/hero";
import { Arrow } from "@/components/landing/icons";
import { NameBuilder } from "@/components/landing/name-builder";
import { PacketAnatomy } from "@/components/landing/packet-anatomy";
import { Reveal } from "@/components/landing/reveal";
import { SectionLabel } from "@/components/landing/section-label";
import { Steps } from "@/components/landing/steps";
import { landing } from "@/lib/i18n/messages/landing";
import { getMessages } from "@/lib/i18n/server";

// Every value on this page is a rule or a format from spec/01-protocol.md. No measurements: none
// exist yet in experiments/results (spec 04 §1, golden rule 5).

/** The heading block every section opens with: the label, the title, the lead. */
function Heading({
  id,
  label,
  title,
  lead,
  center = false,
}: {
  id: string;
  label: string;
  title: ReactNode;
  lead?: ReactNode;
  center?: boolean;
}) {
  return (
    <Reveal className={center ? "mx-auto flex max-w-3xl flex-col items-center text-center" : "max-w-3xl"}>
      <SectionLabel>{label}</SectionLabel>
      <h2 id={id} className="section-title mt-4">
        {title}
      </h2>
      {lead && <p className="section-lead">{lead}</p>}
    </Reveal>
  );
}

/**
 * A top-level home section, marked for the section navigator (it discovers sections from the DOM:
 * `id`, `data-nav-section`, `data-nav-label`).
 */
function Section({
  id,
  nav,
  ground = false,
  children,
}: {
  id: string;
  nav: string;
  ground?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-nav-section=""
      data-nav-label={nav}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-16 border-b border-line ${ground ? "bg-[var(--ground)]" : ""}`}
    >
      {children}
    </section>
  );
}

const linkClass =
  "text-fg underline decoration-line-strong underline-offset-4 transition-colors duration-200 hover:text-interest hover:decoration-interest";

/**
 * The landing page: the hero (the thesis over the routing globe); the idea (agents asking the same
 * thing, over plain MCP and over IDEM); how a call becomes a name and a signed answer; the live name
 * builder and packets; the forwarder's pipeline and where IDEM sits; the guarantees and the call to
 * action. States no numbers until `experiments/results` has some (spec 04 §1).
 */
export default async function Home() {
  const t = await getMessages(landing);
  return (
    <main>
      <Hero />

      <Section id="idea" nav={t.nav.idea}>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <Heading id="idea-title" label={t.idea.label} title={t.idea.title} lead={t.idea.lead} />
          <Reveal delay={0.1} className="mt-12">
            <Swarm />
          </Reveal>
        </div>
      </Section>

      <Section id="how" nav={t.nav.how} ground>
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div className="flex flex-col">
            <Heading id="how-title" label={t.how.label} title={t.how.title} lead={t.how.lead} />
            <dl className="mt-10 border-b border-line">
              {t.how.facts.map((f, i) => (
                <Reveal
                  key={f.term}
                  delay={0.08 + i * 0.05}
                  className="flex items-baseline justify-between gap-6 border-t border-line py-3"
                >
                  <dt className="text-sm text-muted">{f.term}</dt>
                  <dd className="t-mono text-right text-[13px] text-fg">{f.value}</dd>
                </Reveal>
              ))}
            </dl>
          </div>
          <Reveal delay={0.12} className="lg:pt-2">
            <Steps />
          </Reveal>
        </div>
      </Section>

      <Section id="live" nav={t.nav.live}>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <Heading id="live-title" label={t.live.label} title={t.live.title} lead={t.live.lead} />
          <Reveal delay={0.1} className="mt-12">
            <NameBuilder />
          </Reveal>

          <div className="mt-24 grid grid-cols-1 items-end gap-x-16 gap-y-4 lg:grid-cols-2">
            <Reveal>
              <h3 className="font-display text-2xl font-semibold tracking-[-0.025em] text-balance sm:text-3xl">
                {t.live.packetsTitle}
              </h3>
            </Reveal>
            <Reveal delay={0.06}>
              <p className="text-[15px] leading-relaxed text-pretty text-muted">
                {t.live.packetsLead.map((s) => (
                  <span
                    key={s.text}
                    className={s.tone === "i" ? "text-interest" : s.tone === "d" ? "text-data" : ""}
                  >
                    {s.text}
                  </span>
                ))}
              </p>
            </Reveal>
          </div>
          <Reveal delay={0.1} className="mt-10">
            <PacketAnatomy />
          </Reveal>
        </div>
      </Section>

      <Section id="forwarder" nav={t.nav.forwarder} ground>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <Heading
            id="forwarder-title"
            label={t.forwarder.label}
            title={t.forwarder.title}
            lead={t.forwarder.lead}
          />
          <Reveal delay={0.1} className="mt-12">
            <Sorter />
          </Reveal>

          <div className="mt-24 grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
            <Reveal>
              <SectionLabel>{t.where.label}</SectionLabel>
              <h3 className="mt-4 font-display text-2xl font-semibold tracking-[-0.025em] text-balance sm:text-3xl">
                {t.where.title}
              </h3>
              <p className="mt-4 text-[15px] leading-relaxed text-pretty text-muted">{t.where.body}</p>
              <dl className="mt-8 border-b border-line text-sm">
                <div className="grid grid-cols-[6.5rem_1fr] gap-4 border-t border-line py-3">
                  <dt className="font-semibold text-interest">{t.where.today}</dt>
                  <dd className="text-muted">{t.where.todayBody}</dd>
                </div>
                <div className="grid grid-cols-[6.5rem_1fr] gap-4 border-t border-line py-3">
                  <dt className="font-semibold text-faint">{t.where.planned}</dt>
                  <dd className="text-muted">{t.where.plannedBody}</dd>
                </div>
              </dl>
              <p className="mt-4 text-[13px] leading-relaxed text-faint">{t.where.note}</p>
            </Reveal>
            <Reveal delay={0.1}>
              <StackFigure />
            </Reveal>
          </div>
        </div>
      </Section>

      <Section id="guarantees" nav={t.nav.guarantees}>
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28 sm:pb-20">
          <Heading
            id="guarantees-title"
            label={t.guarantees.label}
            title={t.guarantees.title}
            lead={t.guarantees.lead}
            center
          />
          <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:gap-6">
            {t.guarantees.items.map((g, i) => (
              <Reveal
                key={g.title}
                as="li"
                delay={0.06 + (i % 2) * 0.08}
                className="fig-card overflow-hidden"
              >
                <Vignette which={i} />
                <div className="border-t border-line px-5 pt-4 pb-5 sm:px-6">
                  <h3 className="font-display text-lg font-semibold tracking-[-0.02em]">{g.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-pretty text-muted">
                    {g.body.split("readOnlyHint").map((part, k, all) => (
                      <span key={part}>
                        {part}
                        {k < all.length - 1 && (
                          <code className="t-mono text-[13px] text-fg">readOnlyHint</code>
                        )}
                      </span>
                    ))}
                  </p>
                </div>
              </Reveal>
            ))}
          </ol>

          <Reveal
            delay={0.1}
            className="relative mt-24 overflow-hidden rounded-2xl border border-line bg-[var(--ground)] px-5 py-14 text-center sm:px-10 sm:py-16"
          >
            <h2 className="section-title mx-auto max-w-2xl">{t.cta.title}</h2>
            <p className="section-lead mx-auto">{t.cta.body}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/sandbox" className="btn btn-primary">
                {t.cta.sandbox}
                <Arrow className="btn-arrow" />
              </Link>
              <Link href="/docs" className="btn btn-data">
                {t.cta.docs}
              </Link>
            </div>
            <p className="mx-auto mt-10 max-w-xl text-[13px] leading-relaxed text-pretty text-faint">
              {t.cta.fine[0]}
              <Link href="/results" className={linkClass}>
                /results
              </Link>
              {t.cta.fine[1]}
            </p>
          </Reveal>
        </div>
      </Section>
    </main>
  );
}
