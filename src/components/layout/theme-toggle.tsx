"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Theme toggle — single-layer cross-fade.
 *
 * One full-screen panel in the INCOMING page colour fades in, the theme is
 * swapped underneath while it is opaque, then it fades out. Because the panel
 * is the same colour the page becomes, the reveal is seamless: what you see
 * is the screen easing from one shade to the other.
 *
 * Why one layer instead of fading every element:
 *
 * The previous version put a colour transition on `*`. Every surface then
 * animated on its own, and thousands of elements crossing their own
 * intermediates at slightly different perceived rates reads as the page
 * flickering "white, then black" — plus anything that CAN'T be interpolated
 * (gradients, `color-scheme` scrollbars, box-shadow repaints, font
 * antialiasing flipping when a background crosses mid-grey) snapped in the
 * middle of it. Here none of that is visible, because the swap happens
 * behind the panel. It is also far cheaper: one compositor-only `opacity`
 * animation on one element, instead of a full-document style recalculation.
 *
 * The panel is mounted permanently at opacity 0 rather than created on
 * click — a freshly inserted element has no previous value to transition
 * from, so it would jump straight to opaque.
 *
 * Persistence is unchanged and must stay identical to the pre-hydration
 * script in src/app/layout.tsx: `localStorage.theme` + a `dark` class.
 */

type Theme = "light" | "dark";

/** Must match --canvas in globals.css for each theme. */
const CANVAS = { light: "#f5f5f5", dark: "#0a0a0a" } as const;

const COVER_MS = 120;
const REVEAL_MS = 170;
/** Margin so the swap can never land before the panel is fully opaque. */
const SWAP_AT = COVER_MS + 50;

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = React.useState<Theme>("light");
  const [mounted, setMounted] = React.useState(false);
  const [covering, setCovering] = React.useState(false);
  const [coverColor, setCoverColor] = React.useState<string>(CANVAS.dark);
  const busy = React.useRef(false);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const freezeEl = React.useRef<HTMLStyleElement | null>(null);

  /**
   * Kills every element's own transition for the length of the swap, so each
   * one lands on its final colour instantly instead of animating on its own
   * clock and still catching up after the panel has gone. That lag is what
   * made the dashboard cards and the selected sidebar row look glitchy.
   *
   * Injected as a <style> tag rather than written in globals.css because the
   * CSS build silently dropped that one selector — every other custom rule in
   * the file survived. A runtime tag can't be optimised away.
   *
   * The overlay is excluded, or this would kill the very opacity transition
   * that performs the cross-fade.
   */
  const freeze = React.useCallback(() => {
    if (freezeEl.current) return;
    const el = document.createElement("style");
    el.setAttribute("data-theme-freeze", "");
    el.textContent =
      "*:not([data-theme-overlay]),*:not([data-theme-overlay])::before," +
      "*:not([data-theme-overlay])::after{transition:none !important}";
    document.head.appendChild(el);
    freezeEl.current = el;
  }, []);

  const thaw = React.useCallback(() => {
    freezeEl.current?.remove();
    freezeEl.current = null;
  }, []);

  React.useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setMounted(true);
  }, []);

  React.useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      freezeEl.current?.remove();
    },
    [],
  );

  const apply = React.useCallback((next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode — the theme still applies for this session */
    }
    setTheme(next);
  }, []);

  const toggle = React.useCallback(() => {
    if (busy.current) return;
    const root = document.documentElement;
    const next: Theme = root.classList.contains("dark") ? "light" : "dark";

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      apply(next);
      return;
    }

    busy.current = true;
    setCoverColor(CANVAS[next]);
    setCovering(true);

    timers.current.push(
      setTimeout(() => {
        // Freeze every component transition FIRST, so the colour change lands
        // instantly instead of each element animating on its own clock and
        // still catching up after the panel has gone.
        freeze();
        // Swapped while the panel is opaque, so none of it is ever seen.
        apply(next);
        setCovering(false);
        timers.current.push(
          setTimeout(() => {
            // Safe to restore: every value is already final, so nothing has a
            // change left to animate.
            thaw();
            busy.current = false;
          }, REVEAL_MS + 60),
        );
      }, SWAP_AT),
    );
  }, [apply, freeze, thaw]);

  const overlay = (
    <div
      aria-hidden
      data-theme-overlay=""
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: coverColor,
        opacity: covering ? 1 : 0,
        transition: `opacity ${covering ? COVER_MS : REVEAL_MS}ms linear`,
        pointerEvents: "none",
        zIndex: 95,
      }}
    />
  );

  return (
    <>
      {/* Portalled to <body> so it sits above the z-50 sidebar; rendered in
          place it would inherit the header's stacking context and the nav
          would stay lit while the page changed underneath it. */}
      {mounted && createPortal(overlay, document.body)}
      <button
        type="button"
        onClick={toggle}
        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        aria-pressed={theme === "dark"}
        title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        className={cn(
          "relative inline-flex size-8 items-center justify-center overflow-hidden rounded-lg text-muted-foreground",
          "transition-[background-color,color] duration-200 ease-out",
          "hover:bg-accent hover:text-foreground",
          className,
        )}
      >
        {/* Both icons stay mounted and rotate past each other, so the button
            doesn't pop at the moment of the swap. */}
        <Moon
          className={cn(
            "absolute size-4 transition-all duration-300 ease-out",
            theme === "light" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0",
          )}
        />
        <Sun
          className={cn(
            "absolute size-4 transition-all duration-300 ease-out",
            theme === "dark" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-50 opacity-0",
          )}
        />
      </button>
    </>
  );
}
