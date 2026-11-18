import { at, Fig, Head, Node } from "./kit";

// Larger diagrams for the landing: the forwarder pipeline (spec 01 §7), the two packets (§4, §5)
// and the layer stack IDEM sits in. Rules and formats only; no measurements.

const TOP_Y = 40;
const BOTTOM_Y = 236;
/** Box width and column origins: 6 columns of 108 with 22-unit gaps, room for "yes" / "no". */
const W = 108;
const H = 64;
const COL = [20, 150, 280, 410, 540, 670] as const;
const col = (i: number): number => COL[i] ?? 0;
const mid = (i: number): number => col(i) + W / 2;

/**
 * What a forwarder does with an Interest, and with the Data that comes back (§7). The top row is
 * the Interest pipeline in the spec's order (cacheable → valid → CS → PIT → forward), each test
 * leaving the spine downward when it ends the Interest's trip; the bottom row is the Data path
 * (verify → store → satisfy every PIT face → remove the entry).
 */
export function ForwarderFigure() {
  const top: { title: string; lines: string[] }[] = [
    { title: "Interest in", lines: ["from a face"] },
    { title: "cacheable?", lines: ["per the signed", "manifest"] },
    { title: "valid?", lines: ["args digest,", "hop limit, loop"] },
    { title: "fresh in CS?", lines: ["and the scope", "allows it"] },
    { title: "in the PIT?", lines: ["same name", "already pending"] },
    { title: "forward", lines: ["new PIT entry,", "FIB → next hop"] },
  ];
  // Into column i of the spine: the answer to the test in column i − 1 that keeps the Interest going.
  const spine: (string | undefined)[] = [undefined, undefined, "yes", "yes", "no", "no"];
  const out: {
    col: number;
    label: string;
    title: string;
    lines: string[];
    tone?: "i" | "d";
    dashed?: boolean;
  }[] = [
    { col: 1, label: "no", title: "pass through", lines: ["plain MCP call", "bypass"] },
    { col: 2, label: "no", title: "drop", lines: ["error or silent", "drop"], dashed: true },
    { col: 3, label: "yes", title: "reply Data", lines: ["from the CS", "cs_hit"], tone: "d" },
    { col: 4, label: "yes", title: "add the face", lines: ["wait on entry", "pit_aggregate"], tone: "i" },
  ];
  const bottom: { title: string; lines: string[]; tone?: "d" }[] = [
    { title: "consumer", lines: ["verifies again"] },
    { title: "clear entry", lines: ["PIT entry", "removed"] },
    { title: "satisfy", lines: ["every waiting", "face"], tone: "d" },
    { title: "store in CS", lines: ["if cacheable,", "scope allows"] },
    { title: "verify", lines: ["signature,", "contentDigest"] },
    { title: "Data in", lines: ["from upstream"] },
  ];
  const T = 6;
  const sy = TOP_Y + H / 2;
  const by = BOTTOM_Y + H / 2;
  return (
    <Fig
      title="Forwarder pipeline: an Interest is passed through, dropped, answered from the Content Store, aggregated in the PIT, or forwarded; returning Data is verified, cached and delivered to every waiting face"
      w={800}
      h={372}
    >
      <text x={20} y={26} className="f-i" style={{ fontSize: 10.5 }}>
        Interest, downstream → upstream
      </text>
      <text x={20} y={BOTTOM_Y - 14} className="f-d" style={{ fontSize: 10.5 }}>
        Data, upstream → downstream
      </text>
      <path d="M20 200H780" className="s dash" />

      {/* Spines first, so the boxes sit on them and packets show only between boxes. */}
      <path d={`M${COL[0]} ${sy}H${COL[5]}`} className="s" />
      <path d={`M${mid(5)} ${TOP_Y + H}V${BOTTOM_Y}`} className="s" />
      <path d={`M${COL[5]} ${by}H${COL[0] + W}`} className="s" />
      <text x={mid(5) + 6} y={160} className="f-faint" style={{ fontSize: 9 }}>
        upstream
      </text>
      <path
        d={`M${mid(0)} ${sy}H${mid(5)}V${BOTTOM_Y + 4}`}
        pathLength={100}
        className="hop s-i"
        style={at(0, T)}
      />
      <path
        d={`M${mid(5)} ${by}H${mid(0)}`}
        pathLength={100}
        className="hop s-d"
        style={at(T / 4 + 0.3, T)}
      />

      {top.map((n, i) => (
        <Node
          key={n.title}
          x={col(i)}
          y={TOP_Y}
          w={W}
          h={H}
          title={n.title}
          lines={n.lines}
          tone={i === 5 ? "i" : undefined}
        />
      ))}
      {spine.map((label, i) =>
        i === 0 ? null : (
          <g key={i}>
            <Head x={col(i) - 1} y={sy} dir="r" />
            {label && (
              <text
                x={col(i) - 11}
                y={sy - 6}
                textAnchor="middle"
                className="f-faint"
                style={{ fontSize: 9 }}
              >
                {label}
              </text>
            )}
          </g>
        ),
      )}

      {out.map((o) => {
        const cx = mid(o.col);
        const oy = TOP_Y + H + 20;
        const node = (
          <Node
            x={col(o.col)}
            y={oy}
            w={W}
            h={62}
            title={o.title}
            lines={o.lines}
            tone={o.tone}
            dashed={o.dashed}
          />
        );
        return (
          <g key={o.title}>
            <path d={`M${cx} ${TOP_Y + H}V${oy}`} className="s" />
            <Head x={cx} y={oy - 1} dir="d" />
            <text x={cx + 7} y={TOP_Y + H + 13} className="f-faint" style={{ fontSize: 9 }}>
              {o.label}
            </text>
            {o.tone ? (
              <>
                <g opacity={0.35}>{node}</g>
                <g className="blink" style={at(o.tone === "d" ? 0.9 : 1.2, T)}>
                  {node}
                </g>
              </>
            ) : (
              node
            )}
          </g>
        );
      })}

      {bottom.map((n, i) => (
        <Node
          key={n.title}
          x={col(i)}
          y={BOTTOM_Y}
          w={W}
          h={H}
          title={n.title}
          lines={n.lines}
          tone={n.tone}
        />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <Head key={i} x={col(i) + W + 1} y={by} dir="l" />
      ))}
      <Head x={mid(5)} y={BOTTOM_Y - 1} dir="d" />
      <path d={`M${mid(4)} ${BOTTOM_Y + H}V${BOTTOM_Y + 84}`} className="s" />
      <Head x={mid(4)} y={BOTTOM_Y + 83} dir="d" />
      <text x={mid(4) + 7} y={BOTTOM_Y + H + 13} className="f-faint" style={{ fontSize: 9 }}>
        fails
      </text>
      <Node
        x={COL[4]}
        y={BOTTOM_Y + 84}
        w={COL[5] + W - COL[4]}
        h={46}
        title="drop"
        lines={["verify_fail · error to the waiters"]}
        dashed
      />
      <text x={20} y={BOTTOM_Y + 110} className="f-faint" style={{ fontSize: 10 }}>
        Only signed, cacheable answers are ever stored;
      </text>
      <text x={20} y={BOTTOM_Y + 125} className="f-faint" style={{ fontSize: 10 }}>
        private ones only at the edge, per user.
      </text>
    </Fig>
  );
}

const ROW = 32;

function Table({
  x,
  title,
  tone,
  rows,
}: {
  x: number;
  title: string;
  tone: "i" | "d";
  rows: { k: string; v: string; h?: number; dashed?: boolean }[];
}) {
  let y = 52;
  return (
    <g>
      <rect
        x={x}
        y={20}
        width={320}
        height={rows.reduce((s, r) => s + (r.h ?? ROW), 32)}
        rx={9}
        className="f-bg s"
      />
      <rect x={x + 14} y={32} width={8} height={8} className={tone === "i" ? "f-i" : "f-d"} />
      <text x={x + 30} y={40} className={tone === "i" ? "f-i" : "f-d"}>
        {title}
      </text>
      {rows.map((r) => {
        const ry = y;
        y += r.h ?? ROW;
        return (
          <g key={r.k}>
            <path d={`M${x} ${ry}H${x + 320}`} className={`s ${r.dashed ? "dash" : ""}`} />
            <text x={x + 14} y={ry + 20} className={r.dashed ? "f-faint" : "f-fg"} style={{ fontSize: 10.5 }}>
              {r.k}
            </text>
            {r.v.split("\n").map((line, i) => (
              <text key={line} x={x + 120} y={ry + 20 + i * 15} className="f-faint" style={{ fontSize: 10 }}>
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

/** The two packets, field by field, and what the producer's signature covers (§4, §5). */
export function PacketsFigure() {
  return (
    <Fig
      title="The Interest and Data packets field by field; both carry the same name, and the signature covers the name and the metadata"
      w={800}
      h={300}
    >
      <Table
        x={20}
        title="Interest"
        tone="i"
        rows={[
          { k: "name", v: "/idem/v1/…/args-digest" },
          { k: "args", v: "the canonical arguments" },
          { k: "mustBeFresh", v: "default true" },
          { k: "lifetimeMs", v: "how long it may wait in a PIT" },
          { k: "nonce", v: "64 random bits: loops" },
          { k: "hopLimit", v: "decremented at every hop" },
          { k: "authContext", v: "first hop only, never cached", dashed: true },
        ]}
      />
      <Table
        x={460}
        title="Data"
        tone="d"
        rows={[
          { k: "name", v: "the same name" },
          { k: "content", v: "CallToolResult, unchanged" },
          { k: "meta", v: "contentDigest · producedAt\nfreshnessMs · scope\npolicyVersion", h: 64 },
          { k: "signature", v: "Ed25519 · keyLocator · value" },
          { k: "ageMs", v: "time in caches, not signed", dashed: true },
        ]}
      />
      {/* Same name on both sides. */}
      <path d="M340 68H460" className="s s-fg dash" />
      <rect x={386} y={57} width={28} height={22} rx={5} className="f-bg s" />
      <text x={400} y={72} textAnchor="middle" className="f-fg">
        =
      </text>
      <text x={400} y={96} textAnchor="middle" className="f-faint" style={{ fontSize: 9.5 }}>
        same name
      </text>
      <path d="M350 140H450" className="s" />
      <path d="M350 140H450" pathLength={100} className="hop s-i" style={at(0, 4)} />
      <Head x={450} y={140} dir="r" />
      <text x={400} y={130} textAnchor="middle" className="f-faint" style={{ fontSize: 9.5 }}>
        asks
      </text>
      <path d="M450 176H350" className="s" />
      <path d="M450 176H350" pathLength={100} className="hop s-d" style={at(2, 4)} />
      <Head x={350} y={176} dir="l" />
      <text x={400} y={194} textAnchor="middle" className="f-faint" style={{ fontSize: 9.5 }}>
        answers
      </text>
      {/* What the signature covers: name and meta; the content through its digest. */}
      <path d="M786 56H792V178H786" className="s s-d" />
      <rect x={462} y={54} width={316} height={28} rx={4} className="f-soft-d" />
      <rect x={462} y={118} width={316} height={58} rx={4} className="f-soft-d" />
      <text x={460} y={266} className="f-faint" style={{ fontSize: 10 }}>
        Highlighted: the signed bytes. The content is bound
      </text>
      <text x={460} y={281} className="f-faint" style={{ fontSize: 10 }}>
        through meta.contentDigest.
      </text>
    </Fig>
  );
}

const LAYERS: { name: string; what: string; idem?: boolean }[] = [
  { name: "IP", what: "host-to-host delivery" },
  { name: "TCP", what: "a reliable byte stream" },
  { name: "TLS", what: "channel security, hop by hop" },
  { name: "HTTP", what: "request and response" },
  { name: "IDEM", what: "names · PIT · CS · signed Data", idem: true },
  { name: "Application", what: "agent · MCP client and servers" },
];

/** Where IDEM sits: an application-layer overlay over HTTP, below MCP's agents and tools. */
export function StackFigure() {
  const a = 150;
  const b = 56;
  const t = 12;
  const cx = 175;
  return (
    <Fig
      title="The protocol stack, exploded: IP, TCP, TLS, HTTP, the IDEM overlay, and the application with MCP on top"
      w={560}
      h={400}
    >
      {LAYERS.map((l, i) => {
        const cy = 318 - i * 44;
        const top = `M${cx - a} ${cy}L${cx} ${cy - b}L${cx + a} ${cy}L${cx} ${cy + b}Z`;
        const left = `M${cx - a} ${cy}L${cx} ${cy + b}L${cx} ${cy + b + t}L${cx - a} ${cy + t}Z`;
        const right = `M${cx} ${cy + b}L${cx + a} ${cy}L${cx + a} ${cy + t}L${cx} ${cy + b + t}Z`;
        const tone = l.idem ? "s s-i" : "s";
        return (
          <g key={l.name}>
            <path d={left} className={`f-side ${tone}`} />
            <path d={right} className={`f-side ${tone}`} />
            <path d={top} className={`${l.idem ? "f-soft-i" : "f-top"} ${tone}`} />
            {l.idem && (
              <g>
                {/* Kept to the slab's front band: the opaque Application slab covers the rest. */}
                <rect x={cx - 64} y={cy + 8} width={8} height={8} className="f-d" />
                <rect x={cx - 6} y={cy + 34} width={8} height={8} className="f-d" />
                <rect x={cx + 52} y={cy + 12} width={8} height={8} className="f-i" />
                <path
                  d={`M${cx - a} ${cy}L${cx} ${cy - b}L${cx + a} ${cy}L${cx} ${cy + b}Z`}
                  className="s s-i blink"
                  style={at(0, 3)}
                />
              </g>
            )}
            <path d={`M${cx + a + 6} ${cy}H${cx + a + 26}`} className="s" />
            <text x={cx + a + 34} y={cy - 1} className={l.idem ? "f-i" : "f-fg"} style={{ fontSize: 12 }}>
              {l.name}
            </text>
            <text x={cx + a + 34} y={cy + 14} className="f-faint" style={{ fontSize: 10 }}>
              {l.what}
            </text>
          </g>
        );
      })}
    </Fig>
  );
}
