import type { Locale } from "@/lib/i18n/locale";

/** Number formatting for the results page, in the visitor's locale. Units are never translated. */
export interface Format {
  /** A whole number: 1,234. */
  int(n: number): string;
  /** A number with exactly `digits` decimals. */
  num(n: number, digits?: number): string;
  /** A ratio as a percentage: 0.292 → 29.2%. */
  pct(ratio: number, digits?: number): string;
  /** The half-width of an interval on a ratio, in percentage points: 0.016 → 1.6. */
  points(ratio: number, digits?: number): string;
  /** Milliseconds, with a sign when `signed`. */
  ms(n: number, digits?: number, signed?: boolean): string;
  /** Microseconds, switching to ms above 1000 µs. */
  us(n: number): string;
  /** A byte count in binary units: 6 KiB, 1 MiB. */
  bytes(n: number): string;
  /** A duration given in milliseconds, in the unit that reads best: 250 ms, 5 s, 5 min. */
  duration(msValue: number): string;
}

export function makeFormat(locale: Locale): Format {
  const tag = locale === "pt" ? "pt-BR" : "en-US";
  const fixed = (digits: number) =>
    new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const upTo = (digits: number) => new Intl.NumberFormat(tag, { maximumFractionDigits: digits });
  const num = (n: number, digits = 1) => fixed(digits).format(n);
  // A true minus sign, so negative values align and read as numbers.
  const minus = (s: string) => s.replace(/^-/, "−");
  return {
    int: (n) => minus(fixed(0).format(n)),
    num: (n, digits = 1) => minus(num(n, digits)),
    pct: (ratio, digits = 1) => `${minus(num(ratio * 100, digits))}%`,
    points: (ratio, digits = 1) => num(ratio * 100, digits),
    ms: (n, digits = 1, signed = false) => `${signed && n > 0 ? "+" : ""}${minus(num(n, digits))} ms`,
    us: (n) => (n >= 1000 ? `${num(n / 1000, 2)} ms` : `${num(n, n < 100 ? 1 : 0)} µs`),
    bytes: (n) => {
      if (n === 0) return "0";
      if (n >= 1024 * 1024) return `${upTo(1).format(n / (1024 * 1024))} MiB`;
      if (n >= 1024) return `${upTo(1).format(n / 1024)} KiB`;
      return `${upTo(0).format(n)} B`;
    },
    duration: (msValue) => {
      if (msValue >= 60_000) return `${upTo(1).format(msValue / 60_000)} min`;
      if (msValue >= 1000) return `${upTo(1).format(msValue / 1000)} s`;
      return `${upTo(0).format(msValue)} ms`;
    },
  };
}
