/**
 * Shell constants shared by the server layout and the client shell.
 *
 * This module deliberately has NO "use client" directive. When a Server
 * Component imports a value from a client module it receives a React
 * client-reference proxy rather than the value itself — so
 * `cookies().get(SIDEBAR_COOKIE)` would silently look up a cookie literally
 * named "SIDEBAR_COOKIE", never match, and the sidebar would forget its
 * collapsed state on every navigation. Keep these here, not in shell.tsx.
 */

/** Remembers whether the sidebar is pinned open. Value is "true" | "false". */
export const SIDEBAR_COOKIE = "m7_sidebar_pinned";

export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Sidebar widths, matching the 21st.dev SessionNavBar reference exactly:
 * 15rem open, 3.05rem collapsed.
 *
 * FULL_W is both the expanded rail width AND the fixed width of the column
 * inside it — the rail clips that column rather than resizing it, which is
 * what keeps the collapse from relaying out every nav row.
 *
 * The content column offsets itself with Tailwind classes rather than an
 * inline style, so these must stay in sync:
 *   RAIL_W_CSS "3.05rem" === pl-[3.05rem]
 *   FULL_W_CSS "15rem"   === pl-60
 */
export const RAIL_W_CSS = "3.05rem";
export const FULL_W_CSS = "15rem";
/** Same values in px, for the fixed-width inner column. */
export const RAIL_W = 48.8;
export const FULL_W = 240;
