"use client";

import { type MouseEvent, useEffect } from "react";
import { holdFrames } from "@/lib/gpu/device";
import { useResolvedTheme } from "@/lib/hooks/use-theme";
import { useMessages } from "@/lib/i18n/client";
import { chrome } from "@/lib/i18n/messages/chrome";
import { beginReveal, endReveal } from "@/lib/theme-reveal";

type Theme = "light" | "dark";
const KEY = "idem-theme";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

function stored(): Theme | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : undefined;
  } catch {
    return undefined;
  }
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

const VT_VARS = ["--vt-x", "--vt-y", "--vt-r", "--vt-globe-top", "--vt-dots-top"];
/** Switches still running; the last one to finish cleans up. */
let pending = 0;

/** How far `canvas` reaches up under the header (px), so its live layer can be cut there. */
function underHeader(selector: string): string {
  const header = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
  const top = document.querySelector(selector)?.getBoundingClientRect().top ?? 0;
  return `${Math.max(0, header - top)}px`;
}

/** The circle's CSS animation on the new snapshot (globals.css, `theme-reveal`). */
function revealAnimation(): Animation | undefined {
  return document
    .getAnimations()
    .find(
      (a) =>
        a.effect instanceof KeyframeEffect &&
        a.effect.pseudoElement === "::view-transition-new(root)" &&
        (a as CSSAnimation).animationName === "theme-reveal",
    );
}

/**
 * Light / dark toggle. A first-time visitor gets the system appearance (and follows it live);
 * once they pick one, that choice is remembered and wins from then on.
 */
export function ThemeToggle() {
  const theme = useResolvedTheme();
  const t = useMessages(chrome).theme;

  // Until the visitor chooses, track the system appearance as it changes.
  useEffect(() => {
    if (stored()) return;
    const mq = window.matchMedia(LIGHT_QUERY);
    const on = () => {
      if (!stored()) apply(mq.matches ? "light" : "dark");
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // The new theme grows out of the button as a circle until it covers the page (View
  // Transitions). Without the API, or with reduced motion, it switches at once.
  const toggle = (ev: MouseEvent<HTMLButtonElement>) => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const commit = () => {
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // storage unavailable: the choice lasts for this page only
      }
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof document.startViewTransition !== "function") {
      commit();
      return;
    }
    const r = ev.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const root = document.documentElement;
    // The circle is a CSS animation on the new snapshot (globals.css) that reads these; under it a
    // static clip of radius 0 holds for any frame before the animation is in effect, so the new
    // page never shows whole.
    root.style.setProperty("--vt-x", `${x}px`);
    root.style.setProperty("--vt-y", `${y}px`);
    root.style.setProperty("--vt-r", `${end}px`);
    // The hero's canvases leave the snapshots and stay live above them, painting the circle into
    // their own frames (old theme outside, new inside); keep them out of the header.
    root.style.setProperty("--vt-globe-top", underHeader(".globe-canvas"));
    root.style.setProperty("--vt-dots-top", underHeader(".halftone-canvas"));
    root.classList.add("theme-vt");
    const reveal = beginReveal({ x, y, end, from: theme, to: next });
    pending += 1;
    // No canvas may present a frame while the transition captures the page and swaps the theme
    // (in Safari that put the switched page on screen for a frame); they resume once it is up.
    holdFrames(true);
    let vt: ViewTransition;
    try {
      vt = document.startViewTransition(commit);
    } catch {
      holdFrames(false);
      commit();
      return;
    }
    vt.ready
      .then(() => {
        // The globe follows the page's own circle, frame for frame.
        reveal.anim = revealAnimation() ?? null;
      })
      .catch(() => undefined)
      .finally(() => holdFrames(false));
    vt.finished
      .catch(() => undefined)
      .finally(() => {
        holdFrames(false);
        endReveal(reveal);
        pending -= 1;
        if (pending > 0) return; // a newer switch owns the page now
        root.classList.remove("theme-vt");
        for (const k of VT_VARS) root.style.removeProperty(k);
      });
  };

  const label = theme === "dark" ? t.toLight : t.toDark;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="btn btn-icon relative grid place-items-center"
    >
      {/* Which icon shows is driven by <html data-theme> in CSS, so it is right before hydration. */}
      {/* Sun */}
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        aria-hidden="true"
        className="theme-icon theme-icon-sun col-start-1 row-start-1"
      >
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
      </svg>
      {/* Moon */}
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        aria-hidden="true"
        className="theme-icon theme-icon-moon col-start-1 row-start-1"
      >
        <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7Z" />
      </svg>
    </button>
  );
}
