"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  Check,
  TrendingUp,
  Target,
  Heart,
  Plug,
  Link2,
  Image as ImageIcon,
  Hourglass,
  LayoutGrid,
  Clock,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ReverseHuntSection } from "./reverse-hunt-section";
import { ImageHuntSection } from "./image-hunt-section";
import { ManualHuntingSection } from "./manual-hunting-section";

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

function clearRecentHunt(timestamp: number) {
  if (typeof window === "undefined") return;
  try {
    const existing = readRecentHunts();
    const next = existing.filter((h) => h.timestamp !== timestamp);
    window.localStorage.setItem(RECENT_HUNTS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("productHunter:recentHuntsChanged"));
  } catch {
    /* ignore */
  }
}

function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Main view ──────────────────────────────────────────────────────

/**
 * Tab identifiers for the Product Hunter hub.
 *
 *  - manual   → keyword-brainstorm + Etsy scoring (CEO types a seed,
 *               we brainstorm and score against Etsy demand)
 *  - reverse  → paste an AE URL → Etsy demand verdict + projected margin
 *  - image    → paste an image URL → similar AE products
 *  - soon     → roadmap card (Watchlists, Fresh Finds, etc.)
 *
 * Every future hunting tool we build slots in here as a new tab so the
 * whole team has one URL to remember.
 */
type HunterTab = "manual" | "reverse" | "image" | "soon";

/**
 * Initial-tab resolver — reads `?tab=X` from window.location.
 * Computed once during useState lazy init so we don't violate React 19's
 * "no setState in useEffect" rule.
 */
function resolveInitialTab(): HunterTab {
  if (typeof window === "undefined") return "manual";
  const requested = new URLSearchParams(window.location.search).get("tab");
  if (
    requested === "manual" ||
    requested === "reverse" ||
    requested === "image" ||
    requested === "soon"
  ) {
    return requested;
  }
  return "manual";
}

export function ProductHunterView({
  userRole = "SUPER_ADMIN",
}: {
  /** Role gate for the AE connection banner. CEO sees full controls,
   * partners see status-only (no Connect button), everyone else gets
   * the banner hidden entirely. Defaults to SUPER_ADMIN for backward
   * compat with calls that don't pass the prop yet. */
  userRole?: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  const [activeTab, setActiveTab] = useState<HunterTab>(resolveInitialTab);

  // Prefill state — when a recent-hunt card is clicked, this gets set
  // and we pass its values as `initial*` props to ManualHuntingSection
  // PLUS a unique `key={prefill.timestamp}` to force a remount with the
  // new defaults. This is the React 19 way (no setState in useEffect).
  const [prefill, setPrefill] = useState<RecentHunt | null>(null);
  const handlePickRecent = useCallback((hunt: RecentHunt) => {
    setPrefill(hunt);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  // Layout (May 16 2026, third pass — full-width hero per CEO):
  //   1. HeroBanner — FULL-WIDTH (breaks out of <main>'s p-4 md:p-6
  //      padding via negative margins). Inner text still capped at
  //      max-w-5xl for readability on wide displays.
  //   2-5. AE banner, tabs, active mode, recent hunts — all stay
  //      constrained to the centered max-w-5xl content column.
  return (
    <div className="relative pb-12">
      {/* Full-bleed hero: cancels the <main> p-4 md:p-6 + own top
          padding so it spans edge to edge under the dashboard header */}
      <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
        <HeroBanner activeTab={activeTab} />
      </div>

      {/* Constrained content column */}
      <div className="max-w-5xl mx-auto space-y-6">
        <AliExpressConnectionBanner userRole={userRole} />

        <ToolTabsBar active={activeTab} onChange={setActiveTab} />

        {activeTab === "manual" && (
          <ManualHuntingSection
            key={prefill?.timestamp ?? "fresh"}
            initialNiche={prefill?.niche ?? ""}
            initialStyle={prefill?.style ?? null}
            initialAudience={prefill?.audience ?? null}
          />
        )}

        {activeTab === "reverse" && <ReverseHuntSection isCeo={true} />}

        {activeTab === "image" && <ImageHuntSection />}

        {activeTab === "soon" && <ComingSoonRoadmap />}

        {activeTab === "manual" && (
          <RecentHuntsStrip onPick={handlePickRecent} />
        )}
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
    id: "reverse",
    label: "Reverse Hunt",
    icon: Link2,
    description: "Paste AE URL → will it sell?",
    gradient: "from-emerald-500 to-orange-500",
  },
  {
    id: "image",
    label: "Image Hunt",
    icon: ImageIcon,
    description: "Paste image → find the supplier",
    gradient: "from-violet-500 to-pink-500",
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
    description: string;
    cells: Array<{ icon: typeof Sparkles; label: string; sub: string }>;
  }
> = {
  manual: {
    description:
      "Manual hunting — type a seed product type or niche, we brainstorm 25 long-tail variants and score each one against live Etsy demand, engagement, and shop diversity. You stay in control; the system surfaces the angles worth listing.",
    cells: [
      { icon: Sparkles, label: "25 variants", sub: "Haiku brainstorm" },
      { icon: TrendingUp, label: "Live Etsy", sub: "Demand · favorites · shops" },
      { icon: Heart, label: "Ranked", sub: "GREAT · GOOD · MAYBE · SKIP" },
    ],
  },
  reverse: {
    description:
      "Already eyeing a product on AliExpress? Paste the link — we'll fetch it, check Etsy demand, project your margin, and tell you in plain English: source it or skip it.",
    cells: [
      { icon: Sparkles, label: "AE source", sub: "Live price + rating" },
      { icon: TrendingUp, label: "Etsy demand", sub: "Listings + favorites" },
      { icon: Heart, label: "Verdict", sub: "STRONG YES · YES · MAYBE · NO" },
    ],
  },
  image: {
    description:
      "See a competitor's winning Etsy listing? Drop their image URL here — AliExpress image search finds the supplier(s) selling that exact product. Turn their wins into your pipeline.",
    cells: [
      { icon: ImageIcon, label: "Image input", sub: "Any URL works" },
      { icon: Target, label: "Visual match", sub: "AE image-search API" },
      { icon: TrendingUp, label: "12 sources", sub: "Sorted by orders" },
    ],
  },
  soon: {
    description:
      "Hunting tools in the pipeline — Watchlists, Fresh Finds, Bulk URL Checker, Source Health Monitor. Every new tool we build slots in as a tab on this page.",
    cells: [
      { icon: LayoutGrid, label: "Watchlists", sub: "Auto-fetch your niches" },
      { icon: Sparkles, label: "Fresh Finds", sub: "Early but credible" },
      { icon: TrendingUp, label: "Bulk tools", sub: "50 URLs at a time" },
    ],
  },
};

function HeroBanner({ activeTab }: { activeTab: HunterTab }) {
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
            <p className="text-[13px] sm:text-sm text-white/75 mt-2 leading-relaxed max-w-2xl">
              {copy.description}
            </p>
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

function AliExpressConnectionBanner({
  userRole = "SUPER_ADMIN",
}: {
  /** Drives the banner's visibility + action buttons:
   *  - SUPER_ADMIN: full banner with Connect/Disconnect buttons
   *  - PARTNER:     status-only banner (informational, no actions)
   *  - all others:  banner is hidden entirely (employees don't need
   *                 to see AE wiring; the tool just works for them)
   *
   * CEO is the only user who can actually attach an AE account — the
   * OAuth flow happens through their session because every Manual
   * Hunting call borrows the CEO's stored AE token. */
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

  if (!status || !status.connected) {
    // DISCONNECTED — content varies by role. CEO sees the Connect
    // button; Partner sees an informational note pointing to CEO
    // (only the CEO's OAuth flow can attach an AE account because
    // every hunt borrows the CEO's stored token).
    return (
      <Card className="border border-orange-300/50 dark:border-orange-700/40 bg-orange-50/40 dark:bg-orange-950/15 shadow-none">
        <CardContent className="p-4 flex items-center gap-3 flex-wrap">
          <div className="size-9 rounded-xl bg-orange-500/15 ring-1 ring-orange-500/30 flex items-center justify-center shrink-0">
            <Plug className="size-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold leading-tight">
              {isCeo
                ? "Connect AliExpress to unlock full-loop hunting"
                : "AliExpress not connected"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {isCeo
                ? "One-time authorization. Once connected, every keyword expands to a ranked AliExpress product list — no more browsing aliexpress.com manually."
                : "Product previews require AliExpress to be connected by the CEO. Please ask Wasif to connect — it's a one-time auth and the tool will start showing AE previews immediately after."}
            </p>
          </div>
          {isCeo && (
            <a
              href="/api/aliexpress/auth-start"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-bold tracking-wide bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow-md shadow-orange-500/30 hover:opacity-90 transition-opacity"
            >
              <Plug className="size-3.5" />
              Connect AliExpress
            </a>
          )}
        </CardContent>
      </Card>
    );
  }

  // CONNECTED
  const disconnect = async () => {
    if (!confirm("Disconnect AliExpress? You'll need to re-authorize."))
      return;
    await fetch("/api/aliexpress/disconnect", { method: "POST" });
    setStatus({ connected: false });
    toast.success("Disconnected from AliExpress");
  };

  return (
    <Card className="border border-emerald-300/40 dark:border-emerald-700/30 bg-emerald-50/30 dark:bg-emerald-950/10 shadow-none">
      <CardContent className="p-3 flex items-center gap-2.5">
        <div className="size-7 rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center shrink-0">
          <Check
            className="size-3.5 text-emerald-600 dark:text-emerald-400"
            strokeWidth={3}
          />
        </div>
        <div className="min-w-0 flex-1 text-[11px] leading-tight">
          <span className="font-bold text-emerald-700 dark:text-emerald-300">
            AliExpress connected
          </span>
          {status.aliUserNick && (
            <span className="text-muted-foreground">
              {" "}
              · {status.aliUserNick}
            </span>
          )}
          <span className="text-muted-foreground">
            {" "}
            · full-loop hunting active
          </span>
        </div>
        {/* Only CEO can disconnect — partners see status only.
            (Disconnect would break the tool for everyone since every
            hunt borrows the CEO's stored AE token.) */}
        {isCeo && (
          <button
            type="button"
            onClick={disconnect}
            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 hover:text-foreground"
          >
            Disconnect
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Recent hunts strip ─────────────────────────────────────────────
//
// Horizontal scroll of the last N Manual Hunting runs (read from
// localStorage). Click a card → prefills the niche/style/audience
// inputs back into ManualHuntingSection via the onPick callback.
//
// Auto-refreshes when ManualHuntingSection saves a new hunt — it
// dispatches a `productHunter:recentHuntsChanged` custom event and
// this component re-reads the list. Avoids any prop-drilling.

function RecentHuntsStrip({
  onPick,
}: {
  onPick: (hunt: RecentHunt) => void;
}) {
  // Lazy useState initializer reads from localStorage exactly once
  // per mount (no setState-in-effect needed). readRecentHunts() is
  // SSR-safe (returns [] when window is undefined).
  const [hunts, setHunts] = useState<RecentHunt[]>(() => readRecentHunts());

  useEffect(() => {
    // Subscribe pattern only — setHunts is called from event
    // CALLBACKS (allowed), not from the effect body itself.
    const onChange = () => setHunts(readRecentHunts());
    window.addEventListener("productHunter:recentHuntsChanged", onChange);
    // Cross-tab updates
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

  if (hunts.length === 0) return null;

  return (
    <div className="space-y-2.5 ap-stagger-in">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground inline-flex items-center gap-1.5">
          <Clock className="size-3 text-violet-500" />
          Recent hunts
          <span className="text-foreground/60 font-bold tabular-nums">
            · {hunts.length}
          </span>
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1 snap-x">
        {hunts.map((h) => (
          <RecentHuntCard
            key={h.timestamp}
            hunt={h}
            onPick={() => onPick(h)}
            onClear={() => setHunts(readRecentHunts())}
          />
        ))}
      </div>
    </div>
  );
}

function RecentHuntCard({
  hunt,
  onPick,
  onClear,
}: {
  hunt: RecentHunt;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="group relative shrink-0 snap-start min-w-[180px] max-w-[240px] rounded-xl ring-1 ring-border/50 bg-card/80 hover:bg-card hover:ring-border transition-colors overflow-hidden">
      {/* Main click area */}
      <button
        type="button"
        onClick={onPick}
        className="w-full text-left p-3"
        title={`Re-open hunt for "${hunt.niche}"`}
      >
        <p className="text-[12px] font-bold tracking-tight truncate pr-5">
          {hunt.niche}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {hunt.style && (
            <span className="inline-flex items-center text-[9px] font-bold bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30 px-1.5 py-0.5 rounded">
              {hunt.style}
            </span>
          )}
          {hunt.audience && (
            <span className="inline-flex items-center text-[9px] font-bold bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30 px-1.5 py-0.5 rounded">
              {hunt.audience}
            </span>
          )}
        </div>
        <p className="text-[9px] text-muted-foreground tabular-nums mt-1.5">
          {formatTimeAgo(hunt.timestamp)}
          {hunt.categoryCount !== undefined && hunt.productCount !== undefined && (
            <span>
              {" "}
              · {hunt.categoryCount} cats · {hunt.productCount} kw
            </span>
          )}
        </p>
      </button>
      {/* Remove button (hover only) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          clearRecentHunt(hunt.timestamp);
          onClear();
        }}
        className="absolute top-1.5 right-1.5 size-5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-foreground/10 flex items-center justify-center transition-opacity"
        title="Remove from recent"
        aria-label={`Remove "${hunt.niche}" from recent hunts`}
      >
        <X className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}
