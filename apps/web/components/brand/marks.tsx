// Logo concepts for IDEM. Every mark is drawn on a 32×32 grid, monochrome first (`currentColor`),
// with an optional accent variant that uses the two protocol colors: --interest (request) and
// --data (answer).

export type Tone = "mono" | "accent";

interface MarkProps {
  size?: number;
  tone?: Tone;
  className?: string;
}

function Svg({
  size = 32,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

const c = (tone: Tone, accent: string) => (tone === "accent" ? `var(${accent})` : "currentColor");

/** 1. Ditto, geometric: "//" — the ditto mark (″, "idem") drawn as two name separators. */
export function DittoMark({ size, tone = "mono", className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M14.2 6.5 9 25.5" stroke={c(tone, "--interest")} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M23 6.5 17.8 25.5" stroke={c(tone, "--data")} strokeWidth="3.6" strokeLinecap="round" />
    </Svg>
  );
}

/** 2. Ditto, typographic: the tapered ″ of a printed ditto mark. */
export function DittoWedgeMark({ size, tone = "mono", className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M10.2 7h5.2l-4.8 18H8.4Z"
        fill={c(tone, "--interest")}
        stroke={c(tone, "--interest")}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M18.8 7H24l-4.8 18H17Z"
        fill={c(tone, "--data")}
        stroke={c(tone, "--data")}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 3. Fan-in: three requests aggregate in one pending entry; one answer leaves. */
export function FanInMark({ size, tone = "mono", className }: MarkProps) {
  const inC = c(tone, "--interest");
  return (
    <Svg size={size} className={className}>
      <g fill="none" stroke={inC} strokeWidth="2.4" strokeLinecap="round">
        <path d="M4.5 8.5c6 0 8 7.5 13.5 7.5" />
        <path d="M4.5 16H18" />
        <path d="M4.5 23.5c6 0 8-7.5 13.5-7.5" />
      </g>
      <path d="M18 16h9.5" stroke={c(tone, "--data")} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="18" cy="16" r="3.4" fill="currentColor" />
    </Svg>
  );
}

/** 4. Hub & wave: the name at the center, its signed answer radiating back out. */
export function HubMark({ size, tone = "mono", className }: MarkProps) {
  const ring = c(tone, "--data");
  return (
    <Svg size={size} className={className}>
      <circle cx="16" cy="16" r="4.4" fill={c(tone, "--interest")} />
      <circle
        cx="16"
        cy="16"
        r="10"
        fill="none"
        stroke={ring}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="50.3 12.5"
        transform="rotate(-62 16 16)"
      />
      <circle
        cx="16"
        cy="16"
        r="14.2"
        fill="none"
        stroke={ring}
        strokeOpacity="0.38"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="62 27.2"
        transform="rotate(-62 16 16)"
      />
    </Svg>
  );
}

/** 5. Twin: two identical tiles; where request and answer coincide, the name is solid. */
export function TwinMark({ size, tone = "mono", className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <rect
        x="5"
        y="5"
        width="15"
        height="15"
        rx="4"
        fill="none"
        stroke={c(tone, "--interest")}
        strokeWidth="2.2"
      />
      <rect
        x="12"
        y="12"
        width="15"
        height="15"
        rx="4"
        fill="none"
        stroke={c(tone, "--data")}
        strokeWidth="2.2"
      />
      <path d="M16 12h4v4a4 4 0 0 1-4 4h-4v-4a4 4 0 0 1 4-4Z" fill="currentColor" />
    </Svg>
  );
}

/** 6. Wordmark only: lowercase "idem" whose tittle is the Interest. */
export function DotWordmark({ size = 32, tone = "accent" }: { size?: number; tone?: Tone }) {
  return (
    <span
      className="relative inline-block font-semibold leading-none tracking-[-0.045em]"
      style={{ fontSize: size }}
    >
      <span className="relative inline-block">
        ı
        <span
          aria-hidden="true"
          className="absolute left-1/2 rounded-full"
          style={{
            width: "0.2em",
            height: "0.2em",
            top: "-0.02em",
            transform: "translateX(-50%)",
            background: tone === "accent" ? "var(--interest)" : "currentColor",
          }}
        />
      </span>
      dem
    </span>
  );
}

/** Mark + lowercase wordmark lockup. */
export function Lockup({
  Mark,
  tone = "mono",
  size = 28,
}: {
  Mark: (p: MarkProps) => React.ReactElement;
  tone?: Tone;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center" style={{ gap: size * 0.32 }}>
      <Mark size={size} tone={tone} />
      <span className="font-semibold leading-none tracking-[-0.045em]" style={{ fontSize: size * 0.82 }}>
        idem
      </span>
    </span>
  );
}
