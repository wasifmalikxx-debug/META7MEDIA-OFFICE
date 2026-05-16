"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  Check,
  TrendingUp,
  Target,
  Heart,
  Plug,
  Image as ImageIcon,
  Hourglass,
  LayoutGrid,
  X,
  Flame,
  Bookmark,
} from "lucide-react";
import { toast } from "sonner";
import { ImageHuntSection } from "./image-hunt-section";
import { ManualHuntingSection } from "./manual-hunting-section";
import { DailyTrendingView } from "@/components/daily-trending/daily-trending-view";
import { DailyTrendingTabComingSoon } from "@/components/daily-trending/daily-trending-tab-coming-soon";

// ─── Recent hunts storage (localStorage) ─────────────────────────────
//
// Each successful Manual Hunting run is appended to a per-user list in
// localStorage so the hub can show a Recent Hunts strip at the bottom.
// Clicking a card pre-fills the niche input so the seller can re-run
// (or tweak) without retyping. Cap at 12 entries, LRU-style.

export interface RecentHunt {
  niche: string;
  style: string | null;
  audience: string | null;
  timestamp: number;
  categoryCount?: number;
  productCount?: number;
}

const RECENT_HUNTS_KEY = "productHunter.recentHunts.v1";
const RECENT_HUNTS_MAX = 12;

function readRecentHunts(): RecentHunt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_HUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, RECENT_HUNTS_MAX);
  } catch {
    return [];
  }
}

export function saveRecentHunt(hunt: RecentHunt) {
  if (typeof window === "undefined") return;
  try {
    const existing = readRecentHunts();
    // Dedupe by niche+style+audience signature (same query = bump to top)
    const sig = `${hunt.niche.toLowerCase()}|${hunt.style ?? ""}|${hunt.audience ?? ""}`;
    const filtered = existing.filter(
      (h) =>
        `${h.niche.toLowerCase()}|${h.style ?? ""}|${h.audience ?? ""}` !==
        sig,
    );
    const next = [hunt, ...filtered].slice(0, RECENT_HUNTS_MAX);
    window.localStorage.setItem(RECENT_HUNTS_KEY, JSON.stringify(next));
    // Notify any listening components via a custom event
    window.dispatchEvent(new CustomEvent("productHunter:recentHuntsChanged"));
  } catch {
    /* ignore */
  }
}

// formatTimeAgo() lived here for the deleted RecentHuntsStrip card.
// Removed — the inline chips don't show timestamps (would make them
// too long). Resurrect from git history if/when needed again.

/**
 * React hook — returns the live recent-hunts list and re-renders
 * whenever saveRecentHunt() fires (same-tab) or another tab updates
 * localStorage (cross-tab). Lazy initializer avoids the "no setState
 * in useEffect" rule; subscriptions only call setHunts from event
 * callbacks (which is allowed).
 *
 * Used by ManualHuntingSection to show the user's last hunts inline
 * inside the niche input card.
 */
export function useRecentHunts(): RecentHunt[] {
  const [hunts, setHunts] = useState<RecentHunt[]>(() => readRecentHunts());

  useEffect(() => {
    const onChange = () => setHunts(readRecentHunts());
    window.addEventListener("productHunter:recentHuntsChanged", onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === RECENT_HUNTS_KEY) setHunts(readRecentHunts());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(
        "productHunter:recentHuntsChanged",
        onChange,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return hunts;
}

// ─── Main view ──────────────────────────────────────────────────────

/**
 * Tab identifiers for the Product Hunter hub.
 *
 *  - manual    → keyword-brainstorm + Etsy scoring (CEO types a seed,
 *                we brainstorm and score against Etsy demand)
 *  - image     → paste an image URL → similar AE products
 *  - trending  → Daily Trending — morning AE feed scoped to niche book
 *                (CEO-only during validation phase; others see Coming Soon)
 *  - soon      → roadmap card (Watchlists, Fresh Finds, etc.)
 *
 * Removed May 17 2026:
 *  - reverse   → Reverse Hunt (paste AE URL → verdict). CEO call:
 *                ".us URLs don't work and the .com flow was already
 *                covered by Manual Hunting." Files purged with the
 *                tab.
 *
 * Every future hunting tool we build slots in here as a new tab so the
 * whole team has one URL to remember.
 */
type HunterTab = "manual" | "image" | "trending" | "soon";

/**
 * Initial-tab resolver — reads `?tab=X` from window.location.
 * Computed once during useState lazy init so we don't violate React 19's
 * "no setState in useEffect" rule. Legacy `?tab=reverse` quietly
 * falls back to "manual" since Reverse Hunt was removed.
 */
function resolveInitialTab(): HunterTab {
  if (typeof window === "undefined") return "manual";
  const requested = new URLSearchParams(window.location.search).get("tab");
  if (
    requested === "manual" ||
    requested === "image" ||
    requested === "trending" ||
    requested === "soon"
  ) {
    return requested;
  }
  return "manual";
}

export function ProductHunterView({
  userRole = "SUPER_ADMIN",
  currentUserId,
}: {
  /** Role gate for the AE connection banner. CEO sees full controls,
   * partners see status-only (no Connect button), everyone else gets
   * the banner hidden entirely. Defaults to SUPER_ADMIN for backward
   * compat with calls that don't pass the prop yet. */
  userRole?: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
  /** Logged-in user id. Required for the Daily Trending tab so the
   * claim button can flip cards to "Claimed by you". Optional for
   * backward compat — falls back to a no-op claim path. */
  currentUserId?: string;
}) {
  const isCeo = userRole === "SUPER_ADMIN";
  const [activeTab, setActiveTab] = useState<HunterTab>(resolveInitialTab);

  // Recent hunts now live INSIDE the NicheInputCard (May 16 2026 v3
  // CEO ask). No more standalone strip at the bottom and no more
  // prefill prop / key remount on ManualHuntingSection — the input
  // card reads from useRecentHunts() directly and updates its own
  // niche/style/audience state on chip click.
  return (
    <div className="relative pb-12">
      {/* Full-bleed hero: cancels the <main> p-4 md:p-6 + own top
          padding so it spans edge to edge under the dashboard header.
          AE status pill lives INSIDE the hero now (next to Hunting
          hub label) — no separate banner below. */}
      <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
        <HeroBanner activeTab={activeTab} userRole={userRole} />
      </div>

      {/* Constrained content column */}
      <div className="max-w-5xl mx-auto space-y-6">
        <ToolTabsBar active={activeTab} onChange={setActiveTab} />

        {activeTab === "manual" && <ManualHuntingSection />}

        {activeTab === "image" && <ImageHuntSection />}

        {activeTab === "trending" &&
          (isCeo && currentUserId ? (
            <DailyTrendingView
              currentUserId={currentUserId}
              isCeo={isCeo}
              embedded
            />
          ) : (
            <DailyTrendingTabComingSoon />
          ))}

        {activeTab === "soon" && <ComingSoonRoadmap />}
      </div>
    </div>
  );
}

// ─── Tool tabs bar (4-card mode picker) ─────────────────────────────
//
// Restored from the original (pre-Spotlight) design — full-width cards
// with icon + label + description. Each tab keeps its own state inside
// its child section component, so flipping back to "Manual Hunting"
// preserves any in-progress scan results.

const MODE_TABS: Array<{
  id: HunterTab;
  label: string;
  icon: typeof Target;
  description: string;
  gradient: string;
}> = [
  {
    id: "manual",
    label: "Manual Hunting",
    icon: Target,
    description: "Type a seed → find underserved Etsy keywords",
    gradient: "from-sky-500 to-violet-500",
  },
  {
    id: "image",
    label: "Image Hunt",
    icon: ImageIcon,
    description: "Paste image → find the supplier",
    gradient: "from-violet-500 to-pink-500",
  },
  {
    id: "trending",
    label: "Daily Trending",
    icon: Flame,
    description: "Morning AE feed for your niches",
    gradient: "from-orange-500 to-rose-500",
  },
  {
    id: "soon",
    label: "More Soon",
    icon: LayoutGrid,
    description: "Watchlists · Fresh Finds",
    gradient: "from-amber-500 to-rose-500",
  },
];

function ToolTabsBar({
  active,
  onChange,
}: {
  active: HunterTab;
  onChange: (t: HunterTab) => void;
}) {
  return (
    <div className="relative">
      {/* py-1 + -my-1 below preserves a 4px breathing margin so the
          leftmost / rightmost card's outer ring isn't clipped by the
          scroll container (CEO flagged the "Manual Hunting button is
          cropped" issue). */}
      <div className="flex gap-2 overflow-x-auto px-1 py-1 -mx-1 -my-1 snap-x">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`relative flex-1 min-w-[180px] snap-start rounded-2xl ring-1 transition-all overflow-hidden ${
                isActive
                  ? "ring-foreground/30 bg-card shadow-md"
                  : "ring-border/50 bg-card/60 hover:ring-border hover:bg-card"
              }`}
            >
              {isActive && (
                <span
                  aria-hidden
                  className={`absolute inset-0 bg-gradient-to-br ${tab.gradient} opacity-[0.06]`}
                />
              )}
              <div className="relative flex items-center gap-3 p-3">
                <div
                  className={`size-9 rounded-lg flex items-center justify-center shrink-0 ring-1 ${
                    isActive
                      ? `bg-gradient-to-br ${tab.gradient} ring-white/20 shadow-md`
                      : "bg-muted/60 ring-border/40"
                  }`}
                >
                  <Icon
                    className={`size-4 ${
                      isActive ? "text-white" : "text-muted-foreground"
                    }`}
                  />
                </div>
                <div className="min-w-0 text-left">
                  <p
                    className={`text-[12px] font-bold tracking-tight leading-tight ${
                      isActive ? "text-foreground" : "text-foreground/85"
                    }`}
                  >
                    {tab.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">
                    {tab.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Hero banner ────────────────────────────────────────────────────
//
// Dark gradient hero with animated aurora blobs — matches the SEO
// Autopilot hero structurally but uses a COOL (navy → violet → cyan)
// palette to differentiate Product Hunter from the WARM (purple →
// orange) palette of SEO Autopilot. CEO restored this on May 16
// after the Spotlight attempt didn't match the rest of the SEO
// Autopilot family.
//
// Description text + 3 stat cells swap based on the active mode so
// the hero adapts to whichever tool the user picked.

const TAB_COPY: Record<
  HunterTab,
  {
    cells: Array<{ icon: typeof Sparkles; label: string; sub: string }>;
  }
> = {
  manual: {
    cells: [
      { icon: Sparkles, label: "25 variants", sub: "Claude brainstorm" },
      { icon: TrendingUp, label: "Live Etsy", sub: "Demand · favorites · shops" },
      { icon: Heart, label: "Ranked", sub: "GREAT · GOOD · MAYBE · SKIP" },
    ],
  },
  image: {
    cells: [
      { icon: ImageIcon, label: "Image input", sub: "Any URL works" },
      { icon: Target, label: "Visual match", sub: "AE image-search API" },
      { icon: TrendingUp, label: "12 sources", sub: "Sorted by orders" },
    ],
  },
  trending: {
    cells: [
      { icon: Bookmark, label: "Niche book", sub: "Up to 5 niches" },
      { icon: Flame, label: "5 AM PKT", sub: "Auto-refresh daily" },
      { icon: TrendingUp, label: "Pre-priced", sub: "Etsy markup baked in" },
    ],
  },
  soon: {
    cells: [
      { icon: LayoutGrid, label: "Watchlists", sub: "Auto-fetch your niches" },
      { icon: Sparkles, label: "Fresh Finds", sub: "Early but credible" },
      { icon: TrendingUp, label: "Bulk tools", sub: "50 URLs at a time" },
    ],
  },
};

function HeroBanner({
  activeTab,
  userRole,
}: {
  activeTab: HunterTab;
  userRole: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  const copy = TAB_COPY[activeTab];
  return (
    <div className="relative overflow-hidden shadow-xl shadow-violet-500/15 ap-stagger-in border-b border-white/10">
      {/* Base gradient — cool navy → violet → navy to differentiate
          Product Hunter from SEO Autopilot's warm purple → orange.
          Full-bleed (no rounded corners, no side ring) so it spans
          edge-to-edge under the dashboard header. */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d1a2a] via-[#1a1226] to-[#0d1a2a]" />

      {/* Animated aurora blobs — cyan + violet */}
      <div
        aria-hidden
        className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl ap-aurora-1"
        style={{
          background:
            "radial-gradient(closest-side, rgba(34,211,238,0.55), rgba(34,211,238,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl ap-aurora-2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(168,85,247,0.55), rgba(168,85,247,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />

      {/* Inner content is still constrained to max-w-5xl so headlines
          don't sprawl across ultrawide displays — only the visual
          background is full-width. */}
      <div className="relative max-w-5xl mx-auto px-7 sm:px-9 py-8 sm:py-10">
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20 shadow-inner">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            CEO admin · Beta
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/90 tracking-[0.16em] uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
            <Sparkles className="size-3" />
            Hunting hub
          </span>
          {/* AE status pill — sits right next to "Hunting hub" in the
              header row. Role-aware (see component). */}
          <AliExpressHeaderPill userRole={userRole} />
        </div>

        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-sky-400/40 to-violet-500/40 blur-lg ap-orb-pulse"
            />
            <div className="relative size-16 sm:size-[68px] rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-sky-900/40">
              <Target className="size-7 sm:size-8 text-white drop-shadow-lg" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.05]">
              Product Hunter
            </h1>
            {/* Description used to live here; moved out of the hero so
                it reads as a standalone intro paragraph below the
                banner (CEO ask May 16 2026). See <HeroDescription>. */}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          {copy.cells.map((cell) => (
            <FeatureCell
              key={cell.label}
              icon={cell.icon}
              label={cell.label}
              sub={cell.sub}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureCell({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="size-8 rounded-lg bg-white/10 ring-1 ring-white/15 flex items-center justify-center shrink-0">
        <Icon className="size-4 text-white/90" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] sm:text-[12px] font-semibold text-white leading-tight truncate">
          {label}
        </p>
        <p className="text-[10px] text-white/55 leading-tight truncate">{sub}</p>
      </div>
    </div>
  );
}

// ─── Coming Soon roadmap card ───────────────────────────────────────

function ComingSoonRoadmap() {
  const items = [
    {
      icon: LayoutGrid,
      title: "My Watchlists",
      copy: "Save your niches as watchlists — products auto-flow into a triage queue every morning. Skip / Save / List in one click.",
      eta: "Next sprint",
      color: "amber",
    },
    {
      icon: Sparkles,
      title: "Fresh Finds",
      copy: "Newly-listed AliExpress products from credible sellers — catch winners before they saturate. Quality-filtered: 4.7★+, 20-500 orders, established shops only.",
      eta: "Next sprint",
      color: "rose",
    },
    {
      icon: TrendingUp,
      title: "Bulk URL Checker",
      copy: "Paste 50 AliExpress URLs at once → verdict + margin for every one in 90 seconds. Sortable table, bulk Save / Skip.",
      eta: "Soon",
      color: "sky",
    },
    {
      icon: Heart,
      title: "Source Health Monitor",
      copy: "Daily check on every linked AE source for our active listings. Alert when prices rise, stock drops, or seller rating tanks.",
      eta: "Soon",
      color: "emerald",
    },
  ];

  return (
    <div className="space-y-4 ap-stagger-in">
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-11 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 ring-1 ring-amber-500/40 flex items-center justify-center shadow shadow-amber-500/30">
              <Hourglass className="size-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-600 dark:text-amber-400">
                Coming Soon
              </p>
              <h3 className="text-[17px] font-bold leading-tight">
                Hunting tools in the pipeline
              </h3>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => {
              const Icon = item.icon;
              const colorClasses: Record<string, string> = {
                amber:
                  "bg-amber-500/15 ring-amber-500/30 text-amber-600 dark:text-amber-400",
                rose: "bg-rose-500/15 ring-rose-500/30 text-rose-600 dark:text-rose-400",
                sky: "bg-sky-500/15 ring-sky-500/30 text-sky-600 dark:text-sky-400",
                emerald:
                  "bg-emerald-500/15 ring-emerald-500/30 text-emerald-600 dark:text-emerald-400",
              };
              return (
                <div
                  key={item.title}
                  className="rounded-xl ring-1 ring-border/50 bg-card p-4"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`size-9 rounded-lg ring-1 flex items-center justify-center shrink-0 ${colorClasses[item.color]}`}
                    >
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-bold tracking-tight">
                          {item.title}
                        </p>
                        <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 ring-1 ring-border/40 px-1.5 py-0.5 rounded-full">
                          {item.eta}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                        {item.copy}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground/80 mt-4 italic text-center">
            Every new hunting tool we build will appear here as a tab —
            one URL for the whole team.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── AliExpress connection banner ───────────────────────────────────

interface AliConnectionStatus {
  connected: boolean;
  expired?: boolean;
  aliUserNick?: string | null;
  aliUserId?: string | null;
  expiresAt?: string;
  connectedAt?: string;
}

// ─── AE connection pill (lives inside the hero) ─────────────────────
//
// CEO asked May 16 2026 to "shift the AliExpress button into the
// header, right side of Product Hunter (or next to the Hunting hub
// label)". This is the compact pill version that sits in the hero's
// status-pill row, replacing the old below-the-hero card.
//
// Role behaviour (unchanged):
//   - SUPER_ADMIN (CEO): connected → green pill with × disconnect;
//                        disconnected → orange Connect link
//   - PARTNER: connected → green status-only pill;
//              disconnected → orange "ask Wasif" info pill
//   - everyone else: nothing (the tool just works via CEO's token)
function AliExpressHeaderPill({
  userRole = "SUPER_ADMIN",
}: {
  userRole?: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  const [status, setStatus] = useState<AliConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // IMPORTANT: hooks MUST be called unconditionally — the role gate
  // happens AFTER all hooks (early return below).
  useEffect(() => {
    let cancelled = false;

    // Read ?aliConnect=success / denied / state_mismatch from URL on
    // first mount and show a toast — then strip the query param so
    // refreshes don't re-fire it.
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("aliConnect");
    if (flag) {
      const reason = url.searchParams.get("reason");
      if (flag === "success") {
        toast.success("AliExpress connected", {
          description: "Full-loop product hunting is now active.",
        });
      } else if (flag === "denied") {
        toast.error("AliExpress authorization cancelled");
      } else {
        toast.error("AliExpress connection failed", {
          description: reason ?? flag,
        });
      }
      url.searchParams.delete("aliConnect");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.toString());
    }

    async function load() {
      try {
        const res = await fetch("/api/aliexpress/status");
        if (!res.ok) return;
        const data = (await res.json()) as AliConnectionStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // ignore — banner just won't render
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Role gating happens AFTER hooks. Only CEO + Partner ever see the
  // banner. Everyone else gets nothing — the tool just works for them
  // because Manual Hunting borrows the CEO's stored AE token server-side.
  const isCeo = userRole === "SUPER_ADMIN";
  const isPartner = userRole === "PARTNER";
  if (!isCeo && !isPartner) return null;

  if (loading) return null;

  // DISCONNECTED — orange pill. CEO gets a clickable Connect link;
  // partner gets an info-only "ask Wasif" pill.
  if (!status || !status.connected) {
    if (isCeo) {
      return (
        <a
          href="/api/aliexpress/auth-start"
          className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.16em] uppercase bg-gradient-to-r from-orange-500/85 to-rose-600/85 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-orange-300/40 shadow-md shadow-orange-500/25 hover:from-orange-500 hover:to-rose-600 transition-colors"
          title="Connect your AliExpress account"
        >
          <Plug className="size-3" />
          Connect AliExpress
        </a>
      );
    }
    // Partner — info pill, no action
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px] font-bold text-orange-100 tracking-[0.16em] uppercase bg-orange-500/20 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-orange-300/30"
        title="AliExpress not connected — only the CEO can attach an account"
      >
        <Plug className="size-3" />
        AE off · ask Wasif
      </span>
    );
  }

  // CONNECTED — green status pill. CEO sees a tiny × to disconnect;
  // partners see status only.
  const disconnect = async () => {
    if (!confirm("Disconnect AliExpress? You'll need to re-authorize."))
      return;
    await fetch("/api/aliexpress/disconnect", { method: "POST" });
    setStatus({ connected: false });
    toast.success("Disconnected from AliExpress");
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-100 tracking-[0.16em] uppercase bg-emerald-500/20 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-emerald-300/30">
      <Check className="size-3 text-emerald-300" strokeWidth={3} />
      AliExpress connected
      {isCeo && (
        <button
          type="button"
          onClick={disconnect}
          className="ml-0.5 size-3.5 rounded-full hover:bg-white/15 inline-flex items-center justify-center transition-colors -mr-1"
          title="Disconnect AliExpress"
          aria-label="Disconnect AliExpress"
        >
          <X className="size-2.5" strokeWidth={3} />
        </button>
      )}
    </span>
  );
}

// Recent-hunts UI used to live here as a standalone strip at the
// bottom of the page. Consolidated into the NicheInputCard (May 16
// 2026 v3) — see `useRecentHunts()` above + ManualHuntingSection's
// inline chip row. Strip + card components deleted.
