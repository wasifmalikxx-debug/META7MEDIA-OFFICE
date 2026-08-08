"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, type Transition, type Variants } from "framer-motion";
import { ChevronRight, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "@/components/layout/shell";
import { FULL_W, RAIL_W_CSS, FULL_W_CSS } from "@/lib/shell-constants";
import {
  buildNav,
  type NavGroup,
  type NavItem,
  type NavUser,
  type BadgeKey,
} from "@/components/layout/nav-config";

/* ─── Motion ───────────────────────────────────────────────────────────
 *
 * Ported from the 21st.dev SessionNavBar the CEO asked for: the rail tweens
 * between 3.05rem and 15rem on easeOut/0.2s and labels slide in from x:-20.
 *
 * That animation belongs to the HOVER PEEK ONLY. The collapse button is a
 * deliberate switch and uses pinLabelVariants/pinTransition instead — when
 * both shared one animation, the button inherited the peek's stagger and
 * felt broken. `motionSource` on the shell context is what separates them.
 *
 * One thing is deliberately NOT copied. The reference unmounts each label
 * (`{!isCollapsed && <p>}`). That is safe for its fixed-height rows, but
 * this sidebar also has group headings whose height comes from their text —
 * unmounting those collapsed ~16px per group the instant the toggle was
 * clicked and made the whole nav lurch. So every label stays mounted and is
 * animated instead. The rail's overflow-hidden clips it either way, so the
 * result looks identical.
 */

const sidebarVariants: Variants = {
  open: { width: FULL_W_CSS },
  closed: { width: RAIL_W_CSS },
};

const transitionProps: Transition = {
  type: "tween",
  ease: "easeOut",
  duration: 0.2,
};

/** Label slide-and-fade, from the reference. Used for the HOVER peek. */
const hoverLabelVariants: Variants = {
  open: { x: 0, opacity: 1, transition: { x: { stiffness: 1000, velocity: -100 } } },
  closed: { x: -20, opacity: 0, transition: { x: { stiffness: 100 } } },
};

/**
 * The collapse BUTTON is a deliberate switch, not a peek, so it gets no
 * slide and no stagger — just a quick fade in step with the width. Sharing
 * the peek's animation made the button feel like it was lagging.
 */
const pinLabelVariants: Variants = {
  open: { x: 0, opacity: 1, transition: { duration: 0.15, ease: "easeOut" } },
  closed: { x: 0, opacity: 0, transition: { duration: 0.1, ease: "easeIn" } },
};

/**
 * NO cascade — every label animates together.
 *
 * The reference staggers by 0.03s, which is pleasant across its ~10 rows.
 * This nav has 42, and any per-row delay compounds down the list: 0.03 put
 * the last labels 1.26s behind, and even 0.006 left FB Program and Settings
 * visibly arriving after everything above them. The CEO reported that twice.
 * The slide-and-fade below still gives the reference's character; the
 * cascade is what had to go.
 */
const noStaggerVariants: Variants = {
  open: { transition: { staggerChildren: 0 } },
  closed: { transition: { staggerChildren: 0 } },
};

const pinTransition: Transition = { type: "tween", ease: "easeOut", duration: 0.18 };

/* ─── Trailing tags ───────────────────────────────────────────────────── */

/**
 * "CEO only" lock pill. Marks the tools locked to SUPER_ADMIN — Product
 * Validator, SEO Autopilot, Prompt Engineer — so the CEO can see at a glance
 * that his team can't reach them.
 */
function Pill({ kind }: { kind: "ceo" | "admin" }) {
  if (kind === "ceo") {
    return (
      <span
        title="Locked — only you (CEO) can access this tool. Employees, managers and partners can't see or use it."
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
      >
        <Lock className="size-2.5" />
        CEO
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-violet-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
      Admin
    </span>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    // Dark mode's --destructive is a LIGHT red, so white-on-red drops to
    // ~3:1 there. Flip the text dark instead of dimming the badge — this
    // number is the one thing in the sidebar that must catch the eye.
    <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-white tabular-nums dark:text-neutral-950">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ─── Nav row ─────────────────────────────────────────────────────────── */

type RowProps = {
  item: NavItem;
  depth: number;
  expanded: boolean;
  active: boolean;
  badge: number;
  /** Count for the rail dot. Defaults to `badge`; team parents pass their
   *  children's total so the dot doesn't mount from nothing on collapse. */
  railBadge?: number;
  /** Which label animation to use — peek (slide + stagger) vs button (fade). */
  labelVariants: Variants;
  /** Parent rows render a chevron and toggle instead of navigating. */
  open?: boolean;
  onToggle?: () => void;
};

const NavRow = React.forwardRef<HTMLElement, RowProps>(function NavRow(
  { item, depth, expanded, active, badge, railBadge, labelVariants, open, onToggle },
  ref,
) {
  const dotCount = railBadge ?? badge;
  const isParent = !!item.children;
  const Icon = item.icon;

  const body = (
    <>
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active ? "text-foreground" : "text-muted-foreground/80 group-hover:text-foreground/80",
        )}
      />
      <motion.span
        variants={labelVariants}
        className="min-w-0 flex-1 truncate text-left text-[13px] leading-5"
      >
        {item.title}
      </motion.span>

      {/* Stays mounted and only fades. Rendering something different here on
          collapse would change this row's box at the instant of the click,
          while the rail is still animating — a jump, not a transition.
          (Team parents do swap <button>/<a> and drop their chevron, which
          changes this cluster's width by ~14px. Harmless: the team labels are
          short and the row's height and position are untouched.) */}
      <motion.span variants={labelVariants} className="flex shrink-0 items-center gap-1.5">
        {item.pill && <Pill kind={item.pill} />}
        {badge > 0 && <CountBadge count={badge} />}
        {isParent && (
          <ChevronRight
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        )}
      </motion.span>

      {/* Rail mode has no room for a count — a dot still says "look here".
          Absolutely positioned so it contributes no layout either way. */}
      {dotCount > 0 && (
        <span
          className={cn(
            "absolute left-[26px] top-1.5 size-[7px] rounded-full bg-destructive ring-2 ring-sidebar",
            "transition-opacity duration-200 ease-out",
            expanded ? "opacity-0" : "opacity-100",
          )}
        />
      )}
    </>
  );

  const className = cn(
    "group relative flex h-8 w-full items-center gap-2.5 overflow-hidden rounded-md pr-2 text-[13px] transition-colors",
    active
      ? "bg-accent font-medium text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );
  const style = { paddingLeft: depth * 14 + 10 };

  if (isParent) {
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={!expanded ? item.title : undefined}
        className={cn(className, "cursor-pointer")}
        style={style}
      >
        {body}
      </button>
    );
  }

  return (
    <Link
      ref={ref as React.Ref<HTMLAnchorElement>}
      href={item.href!}
      title={!expanded ? item.title : undefined}
      aria-current={active ? "page" : undefined}
      className={className}
      style={style}
    >
      {body}
    </Link>
  );
});

/* ─── Sidebar ─────────────────────────────────────────────────────────── */

export function AppSidebar({ user }: { user: NavUser }) {
  const { expanded, pinned, setHovered, mobileOpen, setMobileOpen, isMobile, motionSource } =
    useShell();
  // The reference's staggered slide is the PEEK animation. The collapse
  // button is a deliberate switch and gets a plain fade instead.
  const isPeek = motionSource === "hover";
  const labelVariants = isPeek ? hoverLabelVariants : pinLabelVariants;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTeam = searchParams.get("team");

  const [pendingDevices, setPendingDevices] = React.useState(0);
  const [pendingByTeam, setPendingByTeam] = React.useState<{ em?: number; ae?: number; me?: number }>({});
  const [openComplaints, setOpenComplaints] = React.useState(0);

  /* ── Pollers (unchanged from the pre-redesign sidebar) ── */

  // Pending device approvals (CEO only).
  React.useEffect(() => {
    if (user.role !== "SUPER_ADMIN") return;
    async function fetchPending() {
      try {
        const res = await fetch("/api/device-approval");
        if (res.ok) {
          const devices: { status?: string }[] = await res.json();
          setPendingDevices(devices.filter((d) => d.status === "PENDING").length);
        }
      } catch {}
    }
    fetchPending();
    const interval = setInterval(fetchPending, 120_000);
    return () => clearInterval(interval);
  }, [user.role]);

  // Per-team pending review counts. CEO fetches all three Etsy teams;
  // partners and Izaan fetch their own. The API ignores ?team= for
  // partners/managers (already pinned to their scope), so passing it is
  // harmless and keeps the fetch logic uniform.
  React.useEffect(() => {
    if (
      user.role !== "SUPER_ADMIN" &&
      user.role !== "MANAGER" &&
      user.role !== "PARTNER"
    ) return;

    const teams: ("em" | "ae" | "me")[] = [];
    if (user.role === "SUPER_ADMIN") {
      teams.push("em", "ae", "me");
    } else if (user.role === "MANAGER" && user.employeeId === "EM-4") {
      teams.push("em");
    } else if (user.role === "PARTNER" && user.partnerTeams) {
      for (const t of user.partnerTeams) {
        if (t.departmentName.includes(" - EM")) teams.push("em");
        else if (t.departmentName.includes(" - AE")) teams.push("ae");
        else if (t.departmentName.includes(" - ME")) teams.push("me");
      }
    }
    if (teams.length === 0) return;

    async function fetchAll() {
      const entries = await Promise.all(
        teams.map(async (key) => {
          try {
            const res = await fetch(`/api/review-bonus?status=PENDING&count=true&team=${key}`);
            if (res.ok) {
              const data = await res.json();
              return [key, typeof data.count === "number" ? data.count : 0] as const;
            }
          } catch {}
          return [key, 0] as const;
        })
      );
      setPendingByTeam(Object.fromEntries(entries));
    }
    fetchAll();
    const interval = setInterval(fetchAll, 120_000);
    return () => clearInterval(interval);
  }, [user.role, user.employeeId, user.partnerTeams]);

  // Complaint counter. CEO/HR → OPEN complaints in the inbox. Everyone else
  // → their own threads the CEO has new content on.
  React.useEffect(() => {
    const isAdminUser = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";
    async function fetchComplaints() {
      try {
        const res = await fetch(isAdminUser ? "/api/complaints?status=OPEN" : "/api/complaints");
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        if (isAdminUser) {
          setOpenComplaints(data.length);
        } else {
          setOpenComplaints(
            (data as { unreadByEmployee?: boolean }[]).filter((c) => c.unreadByEmployee).length,
          );
        }
      } catch {}
    }
    fetchComplaints();
    const interval = setInterval(fetchComplaints, 120_000);
    return () => clearInterval(interval);
  }, [user.role]);

  /* ── Derived nav ── */

  const groups = React.useMemo(() => buildNav(user), [user]);

  const badges = React.useMemo<Record<BadgeKey, number>>(
    () => ({
      devices: pendingDevices,
      complaints: openComplaints,
      "review:em": pendingByTeam.em ?? 0,
      "review:ae": pendingByTeam.ae ?? 0,
      "review:me": pendingByTeam.me ?? 0,
    }),
    [pendingDevices, openComplaints, pendingByTeam],
  );

  // Active-state check that handles ?team= on /bonus-program, /refunds etc.
  // For team-specific links the team param must match too, otherwise every
  // team's "Refunds" would light up at once.
  const isItemActive = React.useCallback(
    (href: string): boolean => {
      const [path, queryStr] = href.split("?");
      if (pathname !== path) return false;
      if (!queryStr) return true;
      const itemTeam = new URLSearchParams(queryStr).get("team");
      if (!itemTeam) return true;
      return currentTeam === itemTeam;
    },
    [pathname, currentTeam],
  );

  const hasActiveChild = React.useCallback(
    (item: NavItem): boolean =>
      (item.children ?? []).some((c) => {
        if (!c.href) return false;
        // "Bonus Guide" is the same URL in all three team sections. Letting a
        // shared link count as that section's active child would spring every
        // team open at once and wipe the CEO's collapse choices. Only
        // team-scoped links (?team=…) identify their own section.
        if (item.id.startsWith("team:") && !c.href.includes("?team=")) return false;
        return isItemActive(c.href);
      }),
    [isItemActive],
  );

  // A parent is open when one of its children is the current page, unless the
  // user has explicitly collapsed it this session.
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});

  // Navigating INTO a collapsed section should reveal it again — otherwise
  // the active page sits hidden behind a closed chevron.
  React.useEffect(() => {
    setOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const group of groups) {
        for (const item of group.items) {
          if (item.children && next[item.id] === false && hasActiveChild(item)) {
            delete next[item.id];
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [groups, hasActiveChild]);

  /* ── Render ── */

  const renderItems = (items: NavItem[], depth = 0): React.ReactNode =>
    items.map((item) => {
      if (item.children) {
        const open = overrides[item.id] ?? hasActiveChild(item);
        const childBadgeTotal = item.children.reduce(
          (sum, c) => sum + (c.badge ? badges[c.badge] ?? 0 : 0),
          0,
        );

        // A rail row is an icon with no chevron and no children, so tapping a
        // team parent there would do nothing — and on a touch device wide
        // enough to miss the hover peek (tablets) a whole team's 6 pages
        // would have no way in. Collapsed, the row becomes a link to the
        // team's first page instead of a disclosure button.
        //
        // Only the ELEMENT changes (button ↔ anchor, same classes, same box).
        // The wrapper and the children below stay mounted in both states —
        // returning a different tree here used to unmount the children and
        // change the nav's height at the instant of the click.
        const firstHref = item.children.find((c) => c.href)?.href;
        const railItem =
          !expanded && firstHref
            ? { ...item, children: undefined, href: firstHref }
            : item;
        // Deliberately `open` alone, NOT `expanded && open`.
        //
        // Tying this to `expanded` meant every collapse folded an open team
        // section shut — 202px of height, 25 rows jumping — while the rail
        // was still narrowing, and every hover-peek unfolded and refolded it
        // again. That was the "glitch". It hid on /dashboard, where no team
        // section is open, which is why an earlier measurement there came
        // back clean.
        //
        // Now the section's height never depends on the rail. The rail simply
        // clips the children horizontally, exactly as it clips labels and the
        // trailing pill. Collapse and peek change width and opacity only.
        const sectionOpen = open;

        return (
          <div key={item.id} className="flex w-full flex-col">
            <NavRow
              item={railItem}
              depth={depth}
              expanded={expanded}
              active={sectionOpen ? false : hasActiveChild(item)}
              // Roll the children's badge up onto the parent while closed so
              // a pending approval isn't hidden inside a collapsed section.
              badge={sectionOpen ? 0 : childBadgeTotal}
              railBadge={childBadgeTotal}
              labelVariants={labelVariants}
              open={sectionOpen}
              onToggle={() => setOverrides((prev) => ({ ...prev, [item.id]: !open }))}
            />
            <div
                // `invisible` when closed is load-bearing, not cosmetic: a
                // grid-rows-[0fr] row still contains focusable links, so
                // without it Tab walks into a section you can't see.
                //
                // `visibility` is in the transition list on purpose. It's a
                // discrete property, so transitioning it holds `visible` for
                // the full duration and flips at the end — otherwise it snaps
                // to hidden on the first frame and the section pops shut
                // instead of collapsing.
                // Collapsing the rail folds any OPEN team section shut, which
                // is ~204px of height per section. That fold is unavoidable
                // (rail mode has no room for children), but it must ride the
                // exact clock the rail and content offset use — on its own
                // 200ms timing it finished early and read as the nav lurching
                // out from under the still-narrowing rail.
                style={{
                  transitionProperty: "grid-template-rows, opacity, visibility",
                  transitionDuration: "var(--shell-duration)",
                  transitionTimingFunction: "var(--shell-ease)",
                }}
                className={cn(
                  "grid",
                  sectionOpen ? "grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="relative flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">
                  <span
                    aria-hidden
                    className="absolute bottom-1 top-0 w-px bg-border"
                    style={{ left: depth * 14 + 18 }}
                  />
                  {renderItems(item.children, depth + 1)}
                </div>
              </div>
          </div>
        );
      }

      return (
        <NavRow
          key={item.id}
          item={item}
          depth={depth}
          expanded={expanded}
          active={isItemActive(item.href!)}
          badge={item.badge ? badges[item.badge] ?? 0 : 0}
          labelVariants={labelVariants}
        />
      );
    });

  return (
    <motion.aside
      initial={false}
      animate={expanded ? "open" : "closed"}
      variants={sidebarVariants}
      transition={isPeek ? transitionProps : pinTransition}
      onMouseEnter={() => setHovered(true)}
      // ⌘B collapses the rail around a pointer that is already inside it. No
      // boundary is crossed, so mouseenter never fires and the peek would sit
      // dead until you left and came back — the exact symptom of the removed
      // "disarm" behaviour. mousemove catches that case.
      onMouseMove={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Off-canvas is a transform, not display:none, so without `inert` the
      // closed drawer keeps ~40 focusable links in the phone's tab order
      // ahead of the actual page content.
      inert={isMobile && !mobileOpen ? true : undefined}
      // Width animates the CLIP BOX only — the column inside stays FULL_W
      // wide, so none of the ~42 nav rows relayout while the rail moves.
      className={cn(
        "shell-rail fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-sidebar-border bg-sidebar",
        // Peeking over the content needs a shadow to read as a layer.
        !pinned && !isMobile && expanded && "shadow-xl shadow-foreground/5",
        // Mobile: off-canvas drawer.
        "max-md:transition-transform max-md:duration-300 max-md:ease-out",
        mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}
    >
      {/* Fixed-width column. Pinning this to FULL_W is what makes the
          collapse cheap: the rail clips it instead of resizing it, so the
          nav rows never re-measure. */}
      <motion.div variants={noStaggerVariants} className="flex h-full flex-col" style={{ width: FULL_W }}>
      {/* ── Brand ──
          Restored to the pre-redesign block on CEO instruction: 32px logo tile
          + "META7MEDIA AI" / "OFFICE MANAGER" / "Powered By: Google".

          The only change from the original is the image source — the same
          artwork, pre-scaled to 32/64/96px and served via srcSet, because the
          original pointed at the 1563px square and let the browser squash it
          (soft at every density). Appearance is identical, just sharp.

          Still a plain <Link> with no dropdown and no hover state. The text
          block stays mounted and only fades, so the row's height is identical
          expanded vs collapsed and the rail stays a pure width+opacity move. */}
      <div className="relative flex shrink-0 items-center border-b border-sidebar-border px-4 py-3">
        <Link
          href="/dashboard"
          aria-label="META7MEDIA AI — go to dashboard"
          className="flex min-w-0 items-center gap-2 overflow-hidden"
        >
          <img
            src="/logo-icon-96.png"
            srcSet="/logo-icon-32.png 32w, /logo-icon-64.png 64w, /logo-icon-96.png 96w"
            sizes="32px"
            alt="META7MEDIA"
            width={32}
            height={32}
            className="size-8 shrink-0 object-contain"
          />
          <motion.span variants={labelVariants} className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-bold">META7MEDIA AI</span>
            <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
              Office Manager
            </span>
            <span className="truncate text-[8px] text-muted-foreground/60">Powered By: Google</span>
          </motion.span>
        </Link>

        {/* Drawer close — mobile only. Absolute so it can't pull the logo off
            centre. */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="absolute right-2 top-1/2 hidden size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:inline-flex"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* ── Nav ── */}
      <nav
        className="shell-scroll flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-2 py-3"
      >
        {groups.map((group: NavGroup) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            {/* The heading keeps its box in both states and only fades.
                Swapping it for a 1px divider when collapsed removed ~16px of
                height PER GROUP the instant the toggle was clicked — six
                groups meant the whole nav lurched ~96px upward while the rail
                was still animating. That lurch was the "glitch". */}
            {group.heading && (
              <motion.span
                variants={labelVariants}
                className="truncate px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60"
              >
                {group.heading}
              </motion.span>
            )}
            {renderItems(group.items)}
          </div>
        ))}
      </nav>

      {/* No account footer. Identity and sign-out moved to the top-right
          avatar (components/layout/user-menu.tsx) on CEO instruction — the
          sidebar is navigation only now. The nav's `flex-1` above already
          claims the space the footer used to hold, so nothing else shifts. */}
      </motion.div>
    </motion.aside>
  );
}
