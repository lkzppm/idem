import type { Metadata } from "next";
import { IdemMark } from "@/components/brand/mark";
import {
  DittoMark,
  DittoWedgeMark,
  DotWordmark,
  FanInMark,
  HubMark,
  Lockup,
  TwinMark,
} from "@/components/brand/marks";
import { brand } from "@/lib/i18n/messages/brand";
import { getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages(brand);
  return { title: t.meta.title, robots: { index: false } };
}

// Explicit palettes so dark and light tiles render side by side regardless of the site theme.
const DARK = {
  "--fg": "#ededed",
  "--interest": "#5aa9ff",
  "--data": "#f5b841",
  background: "#000",
  color: "#ededed",
};
const LIGHT = {
  "--fg": "#0a0a0a",
  "--interest": "#0b63ce",
  "--data": "#b58900",
  background: "#fff",
  color: "#0a0a0a",
};

type MarkC = (p: { size?: number; tone?: "mono" | "accent"; className?: string }) => React.ReactElement;

type ConceptId = keyof (typeof brand)["en"]["concepts"];

/** The explorations, in order; their names and meanings are in `lib/i18n/messages/brand.ts`. */
const CONCEPTS: { id: ConceptId; Mark?: MarkC }[] = [
  { id: "ditto", Mark: DittoMark },
  { id: "wedge", Mark: DittoWedgeMark },
  { id: "fanin", Mark: FanInMark },
  { id: "hub", Mark: HubMark },
  { id: "twin", Mark: TwinMark },
  { id: "dot" },
];

function Tile({ theme, children }: { theme: typeof DARK; children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-36 items-center justify-center rounded-xl border border-line p-6"
      style={theme as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/** One chosen-mark tile: a label under a themed square. */
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {children}
      <p className="t-mono text-xs text-faint">{label}</p>
    </div>
  );
}

/**
 * Brand page: the chosen mark (⇌, `IdemMark`) in both tones, both themes, favicon sizes and the app
 * icon, followed by the earlier explorations it was chosen from.
 */
export default async function BrandPage() {
  const t = await getMessages(brand);
  const label = (tone: "accent" | "mono", theme: "dark" | "light") => `${t.tone[tone]} · ${t.theme[theme]}`;
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16 pb-32 sm:px-6">
      <p className="t-eyebrow">{t.eyebrow}</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-0.04em]">{t.heading}</h1>
      <p className="mt-4 max-w-2xl text-pretty text-muted">{t.lead}</p>

      <section id="chosen" aria-labelledby="chosen-title" className="mt-14 border-t border-line pt-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="t-mono text-xs text-interest">{t.chosen}</span>
          <h2
            id="chosen-title"
            className="flex items-center gap-2 font-display text-2xl font-semibold tracking-[-0.02em]"
          >
            {t.chosenName} <IdemMark size={24} tone="mono" />
          </h2>
        </div>
        <p className="mt-2 max-w-3xl text-pretty text-sm leading-relaxed text-muted">
          {t.chosenBody.before}
          <em>idem</em>
          {t.chosenBody.after}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Labeled label={label("accent", "dark")}>
            <Tile theme={DARK}>
              <Lockup Mark={IdemMark} tone="accent" size={40} />
            </Tile>
          </Labeled>
          <Labeled label={label("accent", "light")}>
            <Tile theme={LIGHT}>
              <Lockup Mark={IdemMark} tone="accent" size={40} />
            </Tile>
          </Labeled>
          <Labeled label={label("mono", "dark")}>
            <Tile theme={DARK}>
              <Lockup Mark={IdemMark} tone="mono" size={40} />
            </Tile>
          </Labeled>
          <Labeled label={label("mono", "light")}>
            <Tile theme={LIGHT}>
              <Lockup Mark={IdemMark} tone="mono" size={40} />
            </Tile>
          </Labeled>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          {[DARK, LIGHT].map((theme, i) => (
            <Labeled
              key={i === 0 ? "dark" : "light"}
              label={`64 · 32 · 20 · 16 px · ${t.theme[i === 0 ? "dark" : "light"]}`}
            >
              <Tile theme={theme}>
                <div className="flex items-end gap-5">
                  {[64, 32, 20, 16].map((s) => (
                    <IdemMark key={s} size={s} tone="accent" />
                  ))}
                </div>
              </Tile>
            </Labeled>
          ))}
          <Labeled label="app/icon.svg · 64 · 32 · 16">
            <div className="flex min-h-36 items-center justify-center gap-5 rounded-xl border border-line bg-[var(--ground)] p-6">
              {[64, 32, 16].map((s) => (
                <img key={s} src="/icon.svg" width={s} height={s} alt={s === 64 ? t.appIcon : ""} />
              ))}
            </div>
          </Labeled>
        </div>
      </section>

      <div className="mt-24">
        <p className="t-eyebrow">{t.earlier}</p>
        <p className="mt-3 max-w-2xl text-pretty text-sm text-muted">{t.earlierLead}</p>
      </div>

      <div className="mt-10 space-y-16">
        {CONCEPTS.map((k, i) => {
          const Mark = k.Mark;
          const c = t.concepts[k.id];
          return (
            <section key={k.id} id={k.id} className="border-t border-line pt-8">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="t-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{c.name}</h2>
              </div>
              <p className="mt-2 max-w-3xl text-pretty text-sm leading-relaxed text-muted">{c.meaning}</p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile theme={DARK}>
                  {k.Mark ? <Lockup Mark={k.Mark} size={36} /> : <DotWordmark size={44} tone="mono" />}
                </Tile>
                <Tile theme={LIGHT}>
                  {k.Mark ? <Lockup Mark={k.Mark} size={36} /> : <DotWordmark size={44} tone="mono" />}
                </Tile>
                <Tile theme={DARK}>
                  {k.Mark ? <Lockup Mark={k.Mark} tone="accent" size={36} /> : <DotWordmark size={44} />}
                </Tile>
                <Tile theme={LIGHT}>
                  {Mark ? (
                    <div className="flex items-end gap-5">
                      {[64, 32, 20, 16].map((s) => (
                        <Mark key={s} size={s} />
                      ))}
                    </div>
                  ) : (
                    <DotWordmark size={44} />
                  )}
                </Tile>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
