// The IDEM mark: two harpoons, ⇌. The upper one runs right, the request (an Interest, blue);
// the lower one runs left, the answer (a Data, amber). Read together they are an equals sign:
// "idem", the same. Turned half a turn, the mark is itself: the answer is the question, returned.
// Drawn on a 32 grid with square caps and mitred barbs, like the rest of the interface.
// `app/icon.svg` is the same drawing on a tile.

/** Upper harpoon: the Interest, left to right, barb up. */
export const MARK_REQUEST = "M7 12.5H25L19.5 7";
/** Lower harpoon: the Data, right to left, barb down (the upper one turned 180°). */
export const MARK_ANSWER = "M25 19.5H7L12.5 25";

/**
 * Where packets meet the mark, as fractions of its box: the Interest leaves from the tip of the
 * upper harpoon; the Data comes home along the lower one, entering at its right end.
 */
export const MARK_PORTS = {
  interest: { x: 25 / 32, y: 12.5 / 32 },
  data: { x: 25 / 32, y: 19.5 / 32 },
} as const;

/**
 * The mark as two stacked drawings, one per harpoon, so each can move on its own (the header's
 * tab story recoils the upper one when an Interest leaves and pops the lower one when the Data
 * lands). Each harpoon is its own `<svg>` box, so its transform animations stay on the compositor.
 * Looks exactly like `IdemMark`.
 */
export function IdemMarkSplit({ size = 24, className = "" }: { size?: number; className?: string }) {
  const svg = {
    viewBox: "0 0 32 32",
    width: size,
    height: size,
    fill: "none",
    strokeWidth: "2.6",
    strokeLinecap: "square",
    strokeLinejoin: "miter",
    "aria-hidden": true,
  } as const;
  return (
    <span
      aria-hidden="true"
      className={`mark-split relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg {...svg} data-harpoon="interest" className="mark-harpoon absolute inset-0">
        <path d={MARK_REQUEST} stroke="var(--interest)" />
      </svg>
      <svg {...svg} data-harpoon="data" className="mark-harpoon absolute inset-0">
        <path d={MARK_ANSWER} stroke="var(--data-bright)" />
      </svg>
    </span>
  );
}

/** The IDEM mark (⇌) as one drawing; in a hovered `group` the harpoons slide past each other. */
export function IdemMark({
  size = 24,
  tone = "accent",
  className = "",
}: {
  size?: number;
  /** `accent`: the protocol colours. `mono`: the current text colour. */
  tone?: "accent" | "mono";
  className?: string;
}) {
  const accent = tone === "accent";
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      strokeWidth="2.6"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
    >
      {/* On a hovered `group`, the two slide past each other: an exchange. */}
      <path
        d={MARK_REQUEST}
        stroke={accent ? "var(--interest)" : "currentColor"}
        className="transition-transform duration-500 ease-[var(--ease-spring)] group-hover:translate-x-[1.5px]"
      />
      <path
        d={MARK_ANSWER}
        stroke={accent ? "var(--data-bright)" : "currentColor"}
        className="transition-transform duration-500 ease-[var(--ease-spring)] group-hover:-translate-x-[1.5px]"
      />
    </svg>
  );
}
