import type { ReactNode } from "react";
import type { docs } from "@/lib/i18n/messages/docs";

/**
 * The docs' diagrams: inline SVG in the project's flat cartoon style. Nodes are solid ink shapes
 * cut out of the page with a background-colored outline, links are dashed, packets are short
 * arrow dashes, and color keeps its one meaning: blue is an Interest (a request), yellow is Data
 * (an answer). Nothing here is measured: the figures show rules and formats, never results.
 *
 * Labels come from the docs dictionary so each figure reads in the visitor's language; names,
 * digests and protocol terms stay as the protocol writes them.
 */

type FigureStrings = (typeof docs)["en"]["fig"];
export type FigureName = keyof FigureStrings;

type Tone = "i" | "d";

/* ---------------------------------------------------------------- primitives */

function Svg({ title, w, h, children }: { title: string; w: number; h: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title} className="dfig">
      <title>{title}</title>
      {children}
    </svg>
  );
}

/** An agent: a solid dot. */
function Agent({ x, y, r = 10 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} className="ink cut" />;
}

/** A forwarder (ink) or a producer (yellow): a solid rounded square. */
function Box({ x, y, s = 40, tone }: { x: number; y: number; s?: number; tone?: Tone }) {
  return (
    <rect
      x={x - s / 2}
      y={y - s / 2}
      width={s}
      height={s}
      rx={s * 0.24}
      className={`${tone === "d" ? "ink-d" : tone === "i" ? "ink-i" : "ink"} cut`}
    />
  );
}

/** A link between two nodes: a dashed line. */
function Wire({
  x1,
  y1,
  x2,
  y2,
  solid,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  solid?: boolean;
}) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} className={solid ? "line" : "line dash"} />;
}

/**
 * A packet on a link, `at` of the way from (x1, y1) to (x2, y2): an arrow dash pointing the way
 * it travels. Interests ride above the link and Data below it, so the two directions never overlap.
 */
function Packet({
  x1,
  y1,
  x2,
  y2,
  at = 0.5,
  tone,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  at?: number;
  tone: Tone;
}) {
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  // Unit normal of the link; Interests go to its left side, Data to its right.
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const off = tone === "i" ? -8 : 8;
  const x = x1 + (x2 - x1) * at + nx * off;
  const y = y1 + (y2 - y1) * at + ny * off;
  return (
    <path
      d="M-10 -3.4H3L10 0L3 3.4H-10Z"
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(tone === "i" ? ang : ang + 180).toFixed(1)})`}
      className={`${tone === "i" ? "ink-i" : "ink-d"} cut`}
    />
  );
}

/** A straight arrow with a head at (x2, y2). */
function Arrow({
  x1,
  y1,
  x2,
  y2,
  tone,
  dash,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone?: Tone;
  dash?: boolean;
}) {
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const stroke = tone === "i" ? "line-i" : tone === "d" ? "line-d" : "line-fg";
  const fill = tone === "i" ? "ink-i" : tone === "d" ? "ink-d" : "ink";
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className={`line ${stroke} ${dash ? "dash" : ""}`} />
      <path
        d="M0 0L-9 -4.4V4.4Z"
        transform={`translate(${x2} ${y2}) rotate(${ang.toFixed(1)})`}
        className={fill}
      />
    </g>
  );
}

function T({
  x,
  y,
  children,
  a = "start",
  c = "",
}: {
  x: number;
  y: number;
  children: ReactNode;
  a?: "start" | "middle" | "end";
  c?: string;
}) {
  return (
    <text x={x} y={y} textAnchor={a} className={c}>
      {children}
    </text>
  );
}

/* ---------------------------------------------------------------- figures */

/** Three agents ask the same thing; one Interest goes upstream and one Data answers all three. */
function Swarm({ t }: { t: FigureStrings["swarm"] }) {
  const agents = [50, 120, 190];
  const edge = { x: 340, y: 120 };
  const prod = { x: 630, y: 120 };
  return (
    <Svg title={t.title} w={720} h={240}>
      {agents.map((y) => (
        <g key={y}>
          <Wire x1={90} y1={y} x2={edge.x} y2={edge.y} />
          <Packet x1={90} y1={y} x2={edge.x} y2={edge.y} at={0.42} tone="i" />
          <Packet x1={90} y1={y} x2={edge.x} y2={edge.y} at={0.66} tone="d" />
        </g>
      ))}
      <Wire x1={edge.x} y1={edge.y} x2={prod.x} y2={prod.y} />
      <Packet x1={edge.x} y1={edge.y} x2={prod.x} y2={prod.y} at={0.36} tone="i" />
      <Packet x1={edge.x} y1={edge.y} x2={prod.x} y2={prod.y} at={0.64} tone="d" />
      {agents.map((y) => (
        <Agent key={y} x={90} y={y} />
      ))}
      <Box x={edge.x} y={edge.y} s={46} />
      <Box x={prod.x} y={prod.y} s={46} tone="d" />
      <T x={215} y={30} a="middle" c="t-i">
        {t.ask}
      </T>
      <T x={215} y={226} a="middle" c="t-d">
        {t.fanout}
      </T>
      <T x={485} y={96} a="middle" c="t-i">
        {t.one}
      </T>
      <T x={485} y={152} a="middle" c="t-d">
        {t.signed}
      </T>
      <T x={18} y={124}>
        {t.agents}
      </T>
      <T x={edge.x} y={170} a="middle" c="t-fg">
        {t.edge}
      </T>
      <T x={edge.x} y={188} a="middle" c="mono t-faint">
        PIT · CS · FIB
      </T>
      <T x={prod.x} y={170} a="middle" c="t-fg">
        {t.producer}
      </T>
      <T x={prod.x} y={188} a="middle" c="t-faint">
        {t.signs}
      </T>
    </Svg>
  );
}

/** The five components of a name, and where each comes from. */
function Name({ t }: { t: FigureStrings["name"] }) {
  const parts: { x: number; w: number; text: string; tone?: Tone; label: readonly string[] }[] = [
    { x: 20, w: 92, text: "/idem/v1", label: t.version },
    { x: 124, w: 146, text: "demo.idem.dev", label: t.producer },
    { x: 282, w: 118, text: "fetch_page", label: t.tool },
    { x: 412, w: 140, text: "schema-digest", label: t.schema },
    { x: 564, w: 136, text: "args-digest", tone: "i", label: t.args },
  ];
  return (
    <Svg title={t.title} w={720} h={172}>
      {parts.map((p, i) => {
        const cx = p.x + p.w / 2;
        return (
          <g key={p.text}>
            <rect
              x={p.x}
              y={20}
              width={p.w}
              height={40}
              rx={9}
              className={p.tone === "i" ? "ink-i" : "ink"}
            />
            <T x={cx} y={45} a="middle" c="mono on-ink">
              {p.text}
            </T>
            {i > 0 && (
              <T x={p.x - 6} y={45} a="middle" c="mono t-faint">
                /
              </T>
            )}
            <line x1={cx} y1={66} x2={cx} y2={90} className="line dash" />
            {p.label.map((l, j) => (
              <T key={l} x={cx} y={110 + j * 18} a="middle" c={j === 0 ? "t-fg" : ""}>
                {l}
              </T>
            ))}
          </g>
        );
      })}
    </Svg>
  );
}

/** A miss with aggregation, then a hit: who talks to whom, in order. */
function Exchange({ t }: { t: FigureStrings["exchange"] }) {
  const a1 = 60;
  const a2 = 150;
  const a3 = 240;
  const edge = 420;
  const prod = 650;
  const cols: { x: number; label: string; kind: "agent" | "fwd" | "prod" }[] = [
    { x: a1, label: `${t.agent} 1`, kind: "agent" },
    { x: a2, label: `${t.agent} 2`, kind: "agent" },
    { x: a3, label: `${t.agent} 3`, kind: "agent" },
    { x: edge, label: t.edge, kind: "fwd" },
    { x: prod, label: t.producer, kind: "prod" },
  ];
  const note = (y: number, text: string) => (
    <T x={edge + 12} y={y} c="mono t-faint">
      {text}
    </T>
  );
  return (
    <Svg title={t.title} w={720} h={396}>
      {cols.map((c) => (
        <g key={c.label}>
          <line x1={c.x} y1={52} x2={c.x} y2={384} className="line dash" />
          {c.kind === "agent" ? (
            <Agent x={c.x} y={38} r={9} />
          ) : (
            <Box x={c.x} y={38} s={28} {...(c.kind === "prod" && { tone: "d" as const })} />
          )}
          <T x={c.x} y={16} a="middle" c="t-fg">
            {c.label}
          </T>
        </g>
      ))}

      <Arrow x1={a1} y1={84} x2={edge - 2} y2={84} tone="i" />
      <T x={a1 + 10} y={77} c="t-i">
        Interest N
      </T>
      <Arrow x1={edge} y1={106} x2={prod - 2} y2={106} tone="i" />
      <T x={(edge + prod) / 2} y={99} a="middle" c="t-i">
        Interest N
      </T>
      {note(124, t.miss)}

      <Arrow x1={a2} y1={146} x2={edge - 2} y2={146} tone="i" />
      {note(150, t.wait2)}
      <Arrow x1={a3} y1={170} x2={edge - 2} y2={170} tone="i" />
      {note(174, t.wait3)}

      <Arrow x1={prod} y1={208} x2={edge + 2} y2={208} tone="d" />
      <T x={(edge + prod) / 2} y={201} a="middle" c="t-d">
        {t.data}
      </T>
      {note(226, t.verify)}

      <Arrow x1={edge} y1={248} x2={a1 + 2} y2={248} tone="d" />
      <Arrow x1={edge} y1={264} x2={a2 + 2} y2={264} tone="d" />
      <Arrow x1={edge} y1={280} x2={a3 + 2} y2={280} tone="d" />
      <T x={edge - 10} y={241} a="end" c="t-d">
        Data N
      </T>

      <line x1={24} y1={308} x2={696} y2={308} className="line dot" />
      <T x={24} y={326} c="t-faint">
        {t.later}
      </T>

      <Arrow x1={a2} y1={350} x2={edge - 2} y2={350} tone="i" />
      <T x={a2 + 10} y={343} c="t-i">
        Interest N
      </T>
      <Arrow x1={edge} y1={372} x2={a2 + 2} y2={372} tone="d" />
      <T x={edge - 10} y={365} a="end" c="t-d">
        {t.fromCs}
      </T>
      {note(366, t.hit)}
    </Svg>
  );
}

/** The three tables a forwarder keeps, and the faces around it. */
function Tables({ t }: { t: FigureStrings["tables"] }) {
  const rows: { y: number; short: string; long: string; key: string; value: string; tone?: Tone }[] = [
    {
      y: 58,
      short: "PIT",
      long: "Pending Interest Table",
      key: "/idem/v1/…/fetch_page/…",
      value: t.pit,
      tone: "i",
    },
    { y: 132, short: "CS", long: "Content Store", key: "/idem/v1/…/fetch_page/…", value: t.cs, tone: "d" },
    {
      y: 206,
      short: "FIB",
      long: "Forwarding Information Base",
      key: "/idem/v1/demo.idem.dev",
      value: t.fib,
    },
  ];
  return (
    <Svg title={t.title} w={720} h={300}>
      <rect x={170} y={16} width={380} height={268} rx={16} className="plate" />
      <T x={190} y={42} c="t-fg">
        {t.forwarder}
      </T>
      {rows.map((r) => (
        <g key={r.short}>
          <rect x={186} y={r.y} width={348} height={62} rx={10} className="card" />
          <T x={200} y={r.y + 23} c="t-fg strong">
            {r.short}
          </T>
          <T x={200 + r.short.length * 9 + 10} y={r.y + 23}>
            {r.long}
          </T>
          <T x={200} y={r.y + 46} c="mono">
            {r.key}
          </T>
          <T x={520} y={r.y + 46} a="end" c={r.tone === "i" ? "t-i" : r.tone === "d" ? "t-d" : "t-fg"}>
            {r.value}
          </T>
        </g>
      ))}

      <T x={86} y={36} a="middle" c="t-fg">
        {t.down}
      </T>
      {[96, 140].map((y) => (
        <g key={y}>
          <Wire x1={20} y1={y} x2={170} y2={y} />
          <Packet x1={20} y1={y} x2={170} y2={y} at={0.5} tone="i" />
        </g>
      ))}
      <T x={86} y={70} a="middle" c="t-i">
        {t.interestsIn}
      </T>
      <Wire x1={20} y1={206} x2={170} y2={206} />
      <Packet x1={20} y1={206} x2={170} y2={206} at={0.5} tone="d" />
      <T x={86} y={240} a="middle" c="t-d">
        {t.dataOut}
      </T>

      <T x={634} y={36} a="middle" c="t-fg">
        {t.up}
      </T>
      <Wire x1={550} y1={118} x2={700} y2={118} />
      <Packet x1={550} y1={118} x2={700} y2={118} at={0.5} tone="i" />
      <T x={634} y={92} a="middle" c="t-i">
        {t.interestOut}
      </T>
      <Wire x1={550} y1={206} x2={700} y2={206} />
      <Packet x1={550} y1={206} x2={700} y2={206} at={0.5} tone="d" />
      <T x={634} y={240} a="middle" c="t-d">
        {t.dataIn}
      </T>
    </Svg>
  );
}

/** The fields of a Data object, and which of them the producer's signature covers. */
function Signed({ t }: { t: FigureStrings["signed"] }) {
  const rows = [
    "name",
    "meta.contentDigest",
    "meta.producedAt",
    "meta.freshnessMs",
    "meta.scope",
    "meta.policyVersion",
    "content",
    "signature { alg, keyLocator, value }",
    "ageMs",
  ];
  const y = (i: number) => 76 + i * 24;
  return (
    <Svg title={t.title} w={720} h={300}>
      <rect x={30} y={16} width={400} height={268} rx={16} className="plate" />
      <T x={52} y={46} c="t-fg strong">
        Data
      </T>
      {rows.map((r, i) => (
        <T key={r} x={52} y={y(i)} c={`mono ${i < 6 ? "t-fg" : ""}`}>
          {r}
        </T>
      ))}
      {/* The signed fields: one bracket, one signature. */}
      <path d={`M300 ${y(0) - 12}H310V${y(5) + 6}H300`} className="line line-d" />
      <line x1={310} y1={y(2) + 8} x2={452} y2={y(2) + 8} className="line line-d dash" />
      <T x={462} y={y(2) - 6} c="t-d">
        {t.signed}
      </T>
      <T x={462} y={y(2) + 13} c="mono">
        {"JCS({ name, …meta })"}
      </T>
      <T x={462} y={y(2) + 31}>
        {t.key}
      </T>

      <line x1={116} y1={y(6) - 4} x2={452} y2={y(6) - 4} className="line dash" />
      <T x={462} y={y(6) - 6} c="t-fg">
        {t.content}
      </T>
      <T x={462} y={y(6) + 12} c="mono">
        SHA-256(JCS(content))
      </T>

      <line x1={100} y1={y(8) - 4} x2={452} y2={y(8) - 4} className="line dash" />
      <T x={462} y={y(8) - 6} c="t-fg">
        {t.age}
      </T>
      <T x={462} y={y(8) + 12}>
        {t.ageWhy}
      </T>
    </Svg>
  );
}

/** How long a cached Data stays fresh, and how its age adds up across caches. */
function Freshness({ t }: { t: FigureStrings["freshness"] }) {
  const x0 = 50;
  const xr = 220;
  const xn = 370;
  const xe = 500;
  const y = 92;
  return (
    <Svg title={t.title} w={720} h={186}>
      {/* The fresh period, then stale. */}
      <rect x={x0} y={y - 9} width={xe - x0} height={18} rx={5} className="ink-d" />
      <rect x={xe + 4} y={y - 9} width={186} height={18} rx={5} className="halftone" />
      <rect x={xe + 4} y={y - 9} width={186} height={18} rx={5} className="line dash" />
      <T x={x0 + 8} y={y - 20} c="t-d">
        {t.fresh}
      </T>
      <T x={xe + 12} y={y - 20} c="t-faint">
        {t.stale}
      </T>

      <line x1={x0} y1={36} x2={x0} y2={y - 9} className="line" />
      <T x={x0} y={28} c="mono t-fg">
        producedAt
      </T>
      <line x1={xe + 2} y1={36} x2={xe + 2} y2={y + 9} className="line" />
      <T x={xe + 2} y={28} a="middle" c="mono t-fg">
        min(freshnessMs, ttlMs)
      </T>

      {/* Age: what the Data already spent upstream, plus its time in this Content Store. */}
      <path d={`M${x0} ${y + 20}v8H${xr - 3}v-8`} className="line" />
      <path d={`M${xr + 3} ${y + 20}v8H${xn}v-8`} className="line line-fg" />
      <T x={(x0 + xr) / 2} y={y + 48} a="middle" c="mono t-fg">
        ageMs
      </T>
      <T x={(x0 + xr) / 2} y={y + 66} a="middle">
        {t.upstream}
      </T>
      <T x={(xr + xn) / 2} y={y + 48} a="middle" c="mono t-fg">
        now − receivedAt
      </T>
      <T x={(xr + xn) / 2} y={y + 66} a="middle">
        {t.here}
      </T>
      <path d="M0 0L-6 10H6Z" transform={`translate(${xn} ${y + 12})`} className="ink cut" />
      <T x={xn + 12} y={y + 48} c="t-fg">
        {t.now}
      </T>
    </Svg>
  );
}

/** The edge's Content Store, partitioned so a private answer never reaches another context. */
function ScopeFigure({ t }: { t: FigureStrings["scope"] }) {
  const shelf = (y: number, label: string, sub: string, dashed = false) => (
    <g>
      <rect x={206} y={y} width={228} height={48} rx={10} className={dashed ? "card dash" : "card"} />
      <T x={220} y={y + 21} c="t-fg">
        {label}
      </T>
      <T x={220} y={y + 38} c="t-faint">
        {sub}
      </T>
      {!dashed && <rect x={398} y={y + 13} width={22} height={22} rx={5} className="ink-d" />}
    </g>
  );
  return (
    <Svg title={t.title} w={720} h={262}>
      <rect x={190} y={16} width={260} height={222} rx={16} className="plate" />
      <T x={206} y={42} c="t-fg strong">
        {t.edge}
      </T>
      {shelf(56, `private · ${t.context} A`, t.onlyA)}
      {shelf(114, "public", t.shared)}
      {shelf(172, `private · ${t.context} B`, t.onlyB)}

      <Wire x1={64} y1={74} x2={206} y2={80} />
      <Wire x1={64} y1={74} x2={206} y2={132} />
      <Wire x1={64} y1={200} x2={206} y2={144} />
      <Wire x1={64} y1={200} x2={206} y2={196} />
      <Agent x={60} y={74} />
      <Agent x={60} y={200} />
      <T x={60} y={50} a="middle" c="t-fg">
        {t.agent} A
      </T>
      <T x={60} y={228} a="middle" c="t-fg">
        {t.agent} B
      </T>

      <Wire x1={450} y1={138} x2={506} y2={138} />
      <rect x={506} y={56} width={194} height={164} rx={16} className="plate" />
      <T x={520} y={82} c="t-fg strong">
        {t.beyond}
      </T>
      <rect x={520} y={96} width={166} height={48} rx={10} className="card" />
      <T x={534} y={117} c="t-fg">
        public
      </T>
      <T x={534} y={134} c="t-faint">
        {t.stored}
      </T>
      <rect x={520} y={154} width={166} height={48} rx={10} className="card dash" />
      <T x={534} y={175} c="t-fg">
        private
      </T>
      <T x={534} y={192} c="t-faint">
        {t.never}
      </T>

      <T x={190} y={256} c="mono t-faint">
        authContext = HMAC({t.edgeSecret}, credential)
      </T>
    </Svg>
  );
}

/** The packages and what each depends on: everything rests on one core. */
function Packages({ t }: { t: FigureStrings["packages"] }) {
  const node = (
    x: number,
    y: number,
    w: number,
    name: string,
    opts: { ink?: boolean; dashed?: boolean } = {},
  ) => (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={40}
        rx={10}
        className={opts.ink ? "ink" : opts.dashed ? "card dash" : "card"}
      />
      <T x={x + w / 2} y={y + 25} a="middle" c={`mono ${opts.ink ? "on-ink" : "t-fg"}`}>
        {name}
      </T>
    </g>
  );
  return (
    <Svg title={t.title} w={720} h={276}>
      <Arrow x1={210} y1={152} x2={300} y2={198} />
      <Arrow x1={500} y1={152} x2={420} y2={198} />
      <Arrow x1={636} y1={152} x2={466} y2={212} dash />
      <Arrow x1={110} y1={64} x2={186} y2={110} />
      <Arrow x1={372} y1={64} x2={256} y2={110} />
      <Arrow x1={428} y1={64} x2={488} y2={110} />
      <Arrow x1={400} y1={64} x2={372} y2={198} />
      <Arrow x1={330} y1={44} x2={184} y2={44} />
      <path d="M60 64C44 168 140 220 250 220" className="line line-fg" />
      <path d="M0 0L-9 -4.4V4.4Z" transform="translate(258 220)" className="ink" />

      {node(40, 24, 140, "@idem/mcp")}
      {node(330, 24, 140, "apps/web")}
      {node(130, 112, 160, "@idem/gateway")}
      {node(430, 112, 140, "@idem/sim")}
      {node(590, 112, 110, "@idem/ndn", { dashed: true })}
      {node(260, 200, 200, "@idem/core", { ink: true })}
      <T x={360} y={262} a="middle">
        {t.core}
      </T>
      <T x={645} y={172} a="middle" c="t-faint">
        {t.planned}
      </T>
      <T x={110} y={16} a="middle" c="t-faint">
        {t.mcp}
      </T>
      <T x={400} y={16} a="middle" c="t-faint">
        {t.web}
      </T>
      <T x={104} y={136} a="end" c="t-faint">
        HTTP
      </T>
      <T x={520} y={104} c="t-faint">
        {t.sim}
      </T>
    </Svg>
  );
}

/** The tree topology: agents, two edges, a regional forwarder, the producer. */
function Topology({ t }: { t: FigureStrings["topology"] }) {
  const agents = [36, 84, 148, 196];
  const edges = [60, 172];
  const reg = { x: 430, y: 116 };
  const prod = { x: 650, y: 116 };
  return (
    <Svg title={t.title} w={720} h={262}>
      {agents.map((y, i) => (
        <Wire key={y} x1={60} y1={y} x2={230} y2={edges[i < 2 ? 0 : 1] ?? 0} />
      ))}
      {edges.map((y) => (
        <Wire key={y} x1={230} y1={y} x2={reg.x} y2={reg.y} />
      ))}
      <Wire x1={reg.x} y1={reg.y} x2={prod.x} y2={prod.y} />
      <Packet x1={60} y1={36} x2={230} y2={60} at={0.5} tone="i" />
      <Packet x1={230} y1={60} x2={reg.x} y2={reg.y} at={0.5} tone="i" />
      <Packet x1={reg.x} y1={reg.y} x2={prod.x} y2={prod.y} at={0.4} tone="i" />
      <Packet x1={reg.x} y1={reg.y} x2={prod.x} y2={prod.y} at={0.62} tone="d" />
      {agents.map((y) => (
        <Agent key={y} x={60} y={y} />
      ))}
      {edges.map((y) => (
        <Box key={y} x={230} y={y} s={40} />
      ))}
      <Box x={reg.x} y={reg.y} s={40} />
      <Box x={prod.x} y={prod.y} s={40} tone="d" />
      <T x={60} y={232} a="middle" c="t-fg">
        {t.agents}
      </T>
      <T x={230} y={232} a="middle" c="t-fg">
        {t.edges}
      </T>
      <T x={230} y={250} a="middle" c="mono t-faint">
        PIT · CS · FIB
      </T>
      <T x={reg.x} y={164} a="middle" c="t-fg">
        {t.regional}
      </T>
      <T x={reg.x} y={182} a="middle" c="t-faint">
        {t.publicOnly}
      </T>
      <T x={prod.x} y={164} a="middle" c="t-fg">
        {t.producer}
      </T>
      <T x={prod.x} y={182} a="middle" c="t-faint">
        {t.signs}
      </T>
    </Svg>
  );
}

/** The three ways the evaluation runs the same workload. */
function Modes({ t }: { t: FigureStrings["modes"] }) {
  const ys = [36, 86, 136];
  const panel = (x: number, name: string, id: string, lines: readonly string[], body: ReactNode) => (
    <g transform={`translate(${x} 0)`}>
      {body}
      {ys.map((y) => (
        <Agent key={y} x={26} y={y} r={8} />
      ))}
      <Box x={196} y={86} s={32} tone="d" />
      <T x={0} y={184} c="t-faint">
        {id}
      </T>
      <T x={26} y={184} c="mono t-fg">
        {name}
      </T>
      {lines.map((l, j) => (
        <T key={l} x={0} y={204 + j * 17}>
          {l}
        </T>
      ))}
    </g>
  );
  return (
    <Svg title={t.title} w={720} h={230}>
      {panel(
        20,
        "mcp-direct",
        "B0",
        t.direct,
        ys.map((y) => (
          <g key={y}>
            <Wire x1={26} y1={y} x2={196} y2={86} />
            <Packet x1={26} y1={y} x2={196} y2={86} at={0.55} tone="i" />
          </g>
        )),
      )}
      {panel(
        256,
        "mcp-local-cache",
        "B1",
        t.local,
        ys.map((y) => (
          <g key={y}>
            <Wire x1={26} y1={y} x2={196} y2={86} />
            <Packet x1={26} y1={y} x2={196} y2={86} at={0.62} tone="i" />
            <rect x={40} y={y - 8} width={16} height={16} rx={4} className="card dash" />
          </g>
        )),
      )}
      {panel(
        492,
        "idem",
        "B2",
        t.idem,
        <g>
          {ys.map((y) => (
            <g key={y}>
              <Wire x1={26} y1={y} x2={110} y2={86} />
              <Packet x1={26} y1={y} x2={110} y2={86} at={0.5} tone="i" />
            </g>
          ))}
          <Wire x1={110} y1={86} x2={196} y2={86} />
          <Packet x1={110} y1={86} x2={196} y2={86} at={0.5} tone="i" />
          <Box x={110} y={86} s={32} />
        </g>,
      )}
    </Svg>
  );
}

const FIGURES: { [K in FigureName]: (props: { t: FigureStrings[K] }) => ReactNode } = {
  swarm: Swarm,
  name: Name,
  exchange: Exchange,
  tables: Tables,
  signed: Signed,
  freshness: Freshness,
  scope: ScopeFigure,
  packages: Packages,
  topology: Topology,
  modes: Modes,
};

export function isFigureName(name: string): name is FigureName {
  return Object.hasOwn(FIGURES, name);
}

/**
 * A figure with its caption. On a narrow screen the drawing keeps a readable size and scrolls
 * sideways instead of shrinking its labels.
 */
export function DocsFigure({
  name,
  caption,
  strings,
}: {
  name: FigureName;
  caption: ReactNode;
  strings: FigureStrings;
}) {
  const Figure = FIGURES[name] as (props: { t: FigureStrings[FigureName] }) => ReactNode;
  return (
    <figure className="docs-figure">
      <div className="docs-figure-scroll" tabIndex={0}>
        <Figure t={strings[name]} />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** The halftone dot pattern the figures share, defined once per page. */
export function DocsFigureDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="docs-figure-defs">
      <defs>
        <pattern id="docs-halftone" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="3.5" cy="3.5" r="1.25" />
        </pattern>
      </defs>
    </svg>
  );
}
