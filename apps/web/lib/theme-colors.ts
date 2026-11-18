/** RGBA in 0..1. */
export type Rgba = [number, number, number, number];

/** Colors the canvas renderers need. Mirrors the CSS tokens in `app/globals.css`. */
export interface Palette {
  dark: boolean;
  bg: Rgba;
  elev: Rgba;
  fg: Rgba;
  muted: Rgba;
  faint: Rgba;
  line: Rgba;
  interest: Rgba;
  data: Rgba;
}

function hex(h: string, a = 1): Rgba {
  const n = Number.parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

export const PALETTES: Record<"dark" | "light", Palette> = {
  dark: {
    dark: true,
    bg: hex("#000000"),
    elev: hex("#0a0a0a"),
    fg: hex("#ededed"),
    muted: hex("#a1a1a1"),
    faint: hex("#6e6e6e"),
    line: hex("#ffffff", 0.12),
    interest: hex("#5aa9ff"),
    data: hex("#f5b841"),
  },
  light: {
    dark: false,
    bg: hex("#ffffff"),
    elev: hex("#fafafa"),
    fg: hex("#0a0a0a"),
    muted: hex("#5c5c5c"),
    faint: hex("#8f8f8f"),
    line: hex("#000000", 0.12),
    interest: hex("#0b63ce"),
    // The saturated gold (CSS --data-bright): every canvas use of yellow is a mark, not small text.
    data: hex("#f2ac00"),
  },
};

/** CSS `rgba()` string for Canvas2D. */
export function css(c: Rgba, alphaMul = 1): string {
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3] * alphaMul})`;
}

/** The theme currently applied to `<html>`. */
export function currentTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
