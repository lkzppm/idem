import type { ReactNode } from "react";

/** The parts of the stack the hero links to. */
export type StackKey = "mcp" | "ndn" | "ndnts" | "ed25519" | "jcs" | "ts";

/**
 * Marks for the stack row. MCP and TypeScript are their brands' marks from Simple Icons (CC0 1.0,
 * v16.38.0), filled in the current colour; the rest have no mark of their own and get a glyph drawn
 * in the landing's line register (24 box, 1.5 stroke).
 */
const BRAND: Partial<Record<StackKey, string>> = {
  mcp: "M13.85 0a4.16 4.16 0 0 0-2.95 1.217L1.456 10.66a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l9.442-9.442a2.49 2.49 0 0 1 3.541 0 2.49 2.49 0 0 1 0 3.541L8.59 12.97l-.1.1a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l.1-.098 7.03-7.034a2.49 2.49 0 0 1 3.542 0l.049.05a2.49 2.49 0 0 1 0 3.54l-8.54 8.54a1.96 1.96 0 0 0 0 2.755l1.753 1.753a.835.835 0 0 0 1.18 0 .835.835 0 0 0 0-1.18l-1.753-1.753a.266.266 0 0 1 0-.394l8.54-8.54a4.185 4.185 0 0 0 0-5.9l-.05-.05a4.16 4.16 0 0 0-2.95-1.218c-.2 0-.401.02-.6.048a4.17 4.17 0 0 0-1.17-3.552A4.16 4.16 0 0 0 13.85 0m0 3.333a.84.84 0 0 0-.59.245L6.275 10.56a4.186 4.186 0 0 0 0 5.902 4.186 4.186 0 0 0 5.902 0L19.16 9.48a.835.835 0 0 0 0-1.18.835.835 0 0 0-1.18 0l-6.985 6.984a2.49 2.49 0 0 1-3.54 0 2.49 2.49 0 0 1 0-3.54l6.983-6.985a.835.835 0 0 0 0-1.18.84.84 0 0 0-.59-.245",
  ts: "M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z",
};

const GLYPH: Partial<Record<StackKey, ReactNode>> = {
  // Named data: a name travelling between nodes.
  ndn: (
    <>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7.2 6h9.6M6.1 7.9l4.8 8.2M17.9 7.9l-4.8 8.2" />
    </>
  ),
  // A library: a package.
  ndnts: (
    <>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  // A signature: a key.
  ed25519: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  // Canonical JSON: braces.
  jcs: (
    <path d="M9 4H8a2 2 0 0 0-2 2v3.5a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 6 14.5V18a2 2 0 0 0 2 2h1M15 4h1a2 2 0 0 1 2 2v3.5a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5V18a2 2 0 0 1-2 2h-1" />
  ),
};

/** The stack, in reading order, with where each name leads. */
export const STACK: { key: StackKey; name: string; href: string }[] = [
  { key: "mcp", name: "MCP", href: "https://modelcontextprotocol.io" },
  { key: "ndn", name: "NDN", href: "https://named-data.net" },
  { key: "ndnts", name: "NDNts", href: "https://yoursunny.com/p/NDNts/" },
  { key: "ed25519", name: "Ed25519", href: "https://www.rfc-editor.org/rfc/rfc8032" },
  { key: "jcs", name: "JCS", href: "https://www.rfc-editor.org/rfc/rfc8785" },
  { key: "ts", name: "TypeScript", href: "https://www.typescriptlang.org" },
];

/** One stack item's mark, in the current colour. */
export function StackMark({ k, size = 16 }: { k: StackKey; size?: number }) {
  const brand = BRAND[k];
  if (brand)
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
        <path d={brand} />
      </svg>
    );
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPH[k]}
    </svg>
  );
}

/**
 * The hero's "built on" row: each part of the stack as its mark and name, linking to its home
 * (opens in a new tab), with what it does for IDEM as the link's title.
 */
export function StackRow({ label, titles }: { label: string; titles: Record<StackKey, string> }) {
  return (
    <div className="hero-stack">
      <span className="hero-stack-label">{label}</span>
      <ul className="hero-stack-list">
        {STACK.map((s) => (
          <li key={s.key}>
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              title={titles[s.key]}
              className="hero-stack-link"
            >
              <StackMark k={s.key} />
              <span>{s.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
