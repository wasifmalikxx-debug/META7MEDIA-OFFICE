"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * App shell — owns the sidebar's open/closed state and the content offset.
 *
 * Three display modes:
 *
 *   pinned (default)   sidebar is a 256px column, content is offset by 256px.
 *   rail               sidebar collapses to a 56px icon rail; hovering it
 *                      expands it back to 256px *over* the content, so
 *                      nothing reflows while you're just looking for a link.
 *   mobile (<768px)    sidebar is an off-canvas drawer over a backdrop and
 *                      the content is never offset.
 *
 * The pinned flag is mirrored into a cookie so the server layout can render
 * the correct offset on the first paint — otherwise every navigation would
 * flash a 256px sidebar before collapsing to the rail.
 */

import { SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE } from "@/lib/shell-constants";

/**
 * Peek is INSTANT in both directions, matching the 21st.dev SessionNavBar
 * reference: `onMouseEnter={() => setIsCollapsed(false)}` /
 * `onMouseLeave={() => setIsCollapsed(true)}` with no timers at all.
 *
 * Two earlier variations were rejected by the CEO and must not come back:
 * a "disarm until the pointer leaves and returns" rule, and a 100ms open
 * delay. Both made the peek feel unresponsive.
 */

// Deliberately NOT re-exporting RAIL_W / FULL_W from here. Re-exporting them
// through a "use client" module would recreate the trap that broke the
// sidebar cookie: the next Server Component to import a width would silently
// receive a client-reference proxy instead of a number. Import them straight
// from @/lib/shell-constants.

type ShellCtx = {
  /** Sidebar is locked open. */
  pinned: boolean;
  togglePinned: () => void;
  /** Mouse is over the collapsed rail. */
  hovered: boolean;
  setHovered: (v: boolean) => void;
  /** A menu launched from the sidebar is open — suppress hover-collapse. */
  setMenuOpen: (v: boolean) => void;
  /**
   * What caused the last width change. The reference sidebar's staggered
   * label animation belongs to the HOVER peek only; the collapse button
   * gets a plain, immediate switch. Without this both shared one animation
   * and the button inherited the stagger.
   */
  motionSource: "hover" | "pin";
  /** Sidebar is currently showing labels (pinned, peeking, or mobile drawer). */
  expanded: boolean;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  isMobile: boolean;
};

const Ctx = React.createContext<ShellCtx | null>(null);

export function useShell() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>");
  return ctx;
}

export function AppShell({
  defaultPinned = true,
  sidebar,
  header,
  children,
}: {
  defaultPinned?: boolean;
  sidebar: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pinned, setPinned] = React.useState(defaultPinned);
  const [hovered, setHovered] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [motionSource, setMotionSource] = React.useState<"hover" | "pin">("pin");

  const togglePinned = React.useCallback(() => {
    // The button is a deliberate switch, not a peek — no stagger, no slide.
    setMotionSource("pin");
    setHovered(false);
    setPinned((prev) => {
      const next = !prev;
      try {
        document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
      } catch {
        /* cookies disabled — state still works for this session */
      }
      return next;
    });
  }, []);

  // Straight through — no timers, exactly like the reference. The only gate
  // is that a pinned-open sidebar has nothing to peek, and hover is
  // meaningless on touch.
  const safeSetHovered = React.useCallback(
    (v: boolean) => {
      if (isMobile || pinned) {
        setHovered(false);
        return;
      }
      setMotionSource("hover");
      setHovered(v);
    },
    [isMobile, pinned],
  );

  // Close the mobile drawer whenever the route changes — otherwise tapping a
  // link leaves the drawer covering the page you just navigated to.
  //
  // The query string is part of the route here: the per-team links differ
  // only by `?team=`, so a CEO on /refunds?team=em tapping Awais's "Refunds"
  // would keep the same pathname and the drawer would never close.
  const search = searchParams.toString();
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname, search]);

  // Escape closes the drawer.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // ⌘B / Ctrl-B collapses the sidebar. Carried over from the shadcn shell
  // this replaced — people had it in their fingers.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        togglePinned();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePinned]);

  // Body scroll lock while the drawer is open.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // `menuOpen` keeps the rail expanded while a dropdown launched from it is
  // open. Without it, moving the pointer onto the body-portalled menu fires
  // the sidebar's onMouseLeave and the rail collapses under its own menu.
  const expanded = isMobile ? true : pinned || hovered || menuOpen;

  const value = React.useMemo<ShellCtx>(
    () => ({
      pinned,
      togglePinned,
      hovered,
      setHovered: safeSetHovered,
      setMenuOpen,
      motionSource,
      expanded,
      mobileOpen,
      setMobileOpen,
      isMobile,
    }),
    [pinned, togglePinned, hovered, safeSetHovered, expanded, mobileOpen, isMobile, motionSource],
  );

  return (
    <Ctx.Provider value={value}>
      <div className="app-canvas relative flex min-h-svh w-full flex-1">
        {sidebar}

        {/* Mobile backdrop */}
        <div
          aria-hidden={!mobileOpen}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[2px] transition-opacity duration-200 md:hidden",
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        />

        {/* The offset is CLASS-based, never an inline style. useIsMobile()
            reports false during SSR and on the first client render, so an
            inline paddingLeft would ship `padding-left:256px` to phones and
            crush the page into ~119px until hydration caught up — and no
            `md:` class can outrank an inline style. Widths track RAIL_W /
            FULL_W in @/lib/shell-constants. */}
        <div
          className={cn(
            // .shell-content carries the same duration and curve as
            // .shell-rail. These are separate elements animating one visual
            // motion, so any difference shows up as the boundary tearing —
            // which is exactly what the first version did.
            // Widths track RAIL_W_CSS / FULL_W_CSS in @/lib/shell-constants:
            // pl-60 = 15rem, pl-[3.05rem] = the collapsed rail.
            "shell-content flex min-w-0 flex-1 flex-col pl-0",
            pinned ? "md:pl-60" : "md:pl-[3.05rem]",
          )}
        >
          {header}
          {/* min-w-0 is load-bearing: wide content (5-card stat grids, long
              table rows) would otherwise push <main> past the viewport's
              right edge and get clipped. Daily Activities specifically
              tripped this. */}
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
