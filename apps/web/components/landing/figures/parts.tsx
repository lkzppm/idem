import type { ReactNode, Ref } from "react";

/*
 * SVG pieces shared by the landing's animated figures, in the hero's vocabulary: flat fills, an
 * outline in the figure's background colour so a shape sits cleanly on the lines under it, and the
 * two accents with one meaning each (blue: a request, an Interest; yellow: an answer, a Data).
 * Each piece draws around (0, 0); a figure places it with a transform, so the frame function only
 * ever writes `transform` and `opacity`.
 */

/**
 * A packet: a capsule with two puffs behind it (shown only while it moves). Drawn by `putPacket`.
 * `i` an Interest, `d` a Data, `o` a plain MCP message (no name, no signature: an outline only).
 */
export function Packet({ tone, k, r = 4.6 }: { tone: "i" | "d" | "o"; k?: string; r?: number }) {
  return (
    <g data-k={k} className={`pk pk-${tone}`} opacity={0} visibility="hidden">
      <circle cx={-r * 3.1} cy={0} r={r * 0.34} className="pk-puff" />
      <circle cx={-r * 2.1} cy={0} r={r * 0.5} className="pk-puff" />
      <g>
        <rect x={-r * 1.25} y={-r} width={r * 2.5} height={r * 2} rx={r} className="pk-body" />
      </g>
    </g>
  );
}

/** An agent (a consumer): a solid dot. Its state is a class on the group (`is-wait`, `is-done`). */
export function Agent({ k, r = 7.5, children }: { k?: string; r?: number; children?: ReactNode }) {
  return (
    <g data-k={k} className="nd-agent">
      <circle r={r + 2} className="o-fill" />
      <circle r={r} className="nd-agent-dot" />
      {children}
    </g>
  );
}

/** A forwarder (an edge gateway): a rounded square with an ink outline. */
export function Forwarder({ k, h = 13 }: { k?: string; h?: number }) {
  return (
    <g data-k={k} className="nd-fwd">
      <rect x={-h - 2} y={-h - 2} width={2 * h + 4} height={2 * h + 4} rx={7} className="o-fill" />
      <rect x={-h} y={-h} width={2 * h} height={2 * h} rx={5.5} className="nd-fwd-body" />
    </g>
  );
}

/** A regional forwarder or a core: a ringed circle with a dot. */
export function Core({ k, r = 12 }: { k?: string; r?: number }) {
  return (
    <g data-k={k} className="nd-core">
      <circle r={r + 2} className="o-fill" />
      <circle r={r - 1} className="nd-core-ring" />
      <circle r={r * 0.36} className="nd-core-dot" />
    </g>
  );
}

/** The producer: an ink square holding a yellow one (it signs the answers). */
export function Producer({ k, h = 15 }: { k?: string; h?: number }) {
  return (
    <g data-k={k} className="nd-prod">
      <rect x={-h - 2.5} y={-h - 2.5} width={2 * h + 5} height={2 * h + 5} rx={7} className="o-fill" />
      <rect x={-h} y={-h} width={2 * h} height={2 * h} rx={5} className="f-fg" />
      <rect x={-h * 0.42} y={-h * 0.42} width={h * 0.84} height={h * 0.84} rx={2} className="f-db" />
    </g>
  );
}

/** A check mark, drawn with a round stroke. */
export function Check({ k, tone = "d", s = 1 }: { k?: string; tone?: "i" | "d" | "fg"; s?: number }) {
  return (
    <g data-k={k}>
      <circle r={9 * s} className="o-fill" />
      <path
        d={`M${-4.6 * s} ${0.2 * s}l${3.2 * s} ${3.2 * s}l${6 * s} ${-6.4 * s}`}
        className={`mk mk-${tone}`}
        strokeWidth={2.4 * s}
      />
    </g>
  );
}

/** A cross, for what is rejected. */
export function Cross({ k, s = 1 }: { k?: string; s?: number }) {
  return (
    <g data-k={k}>
      <circle r={9 * s} className="o-fill" />
      <path
        d={`M${-4 * s} ${-4 * s}l${8 * s} ${8 * s}M${4 * s} ${-4 * s}l${-8 * s} ${8 * s}`}
        className="mk mk-fg"
        strokeWidth={2.4 * s}
      />
    </g>
  );
}

/**
 * The producer's seal: a yellow scalloped stamp with a tick, set on a signed Data. A stamp, not a
 * badge: it lands with a squash when the signature is made.
 */
export function Seal({ k, r = 11 }: { k?: string; r?: number }) {
  const n = 12;
  let d = "";
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.84;
    d += `${i === 0 ? "M" : "L"}${(Math.cos(a) * rr).toFixed(2)} ${(Math.sin(a) * rr).toFixed(2)}`;
  }
  return (
    <g data-k={k} className="seal">
      <path d={`${d}Z`} className="seal-body" />
      <path
        d={`M${-r * 0.36} ${r * 0.02}l${r * 0.24} ${r * 0.24}l${r * 0.46} ${-r * 0.5}`}
        className="seal-tick"
      />
    </g>
  );
}

/** A dot field: the hero's halftone, as an SVG pattern (flat dots, no gradient). */
export function Halftone({ id, step = 7, r = 1.1 }: { id: string; step?: number; r?: number }) {
  return (
    <pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse">
      <circle cx={step / 2} cy={step / 2} r={r} className="ht-dot" />
    </pattern>
  );
}

/**
 * An SVG figure in the landing's figure style: scales to its box, labelled for assistive tech.
 * `interactive` figures (with focusable parts inside) are a labelled group rather than an image,
 * since an image's children are hidden from assistive tech.
 */
export function Svg({
  title,
  w,
  h,
  children,
  className = "",
  svgRef,
  interactive = false,
}: {
  title: string;
  w: number;
  h: number;
  children: ReactNode;
  className?: string;
  svgRef?: Ref<SVGSVGElement>;
  interactive?: boolean;
}) {
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      role={interactive ? "group" : "img"}
      aria-label={title}
      className={`fig mfig ${className}`}
    >
      <title>{title}</title>
      {children}
    </svg>
  );
}

/** Look up a figure's moving parts by their `data-k`, once per mount. */
export function parts(root: Element | null): (k: string) => Element | null {
  const cache = new Map<string, Element | null>();
  return (k: string) => {
    if (!root) return null;
    let el = cache.get(k);
    if (!el?.isConnected) {
      el = root.querySelector(`[data-k="${k}"]`);
      cache.set(k, el);
    }
    return el;
  };
}
