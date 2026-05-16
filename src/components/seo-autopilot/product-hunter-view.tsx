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

export function ProductHunterView() {
  const [activeTab, setActiveTab] = useState<HunterTab>(resolveInitialTab);

  // Prefill state — when a recent-hunt card is clicked, this gets set
  // and we pass its values as `initial*` props to ManualHuntingSection
  // PLUS a unique `key={prefill.timestamp}` to force a remount with the
  // new defaults. This is the React 19 way (no setState in useEffect).
  const [prefill, setPrefill] = useState<RecentHunt | null>(null);
  const handlePickRecent = useCallback((hunt: RecentHunt) => {
    setPrefill(hunt);
    // Scroll the input back into view in case we were scrolled down on
    // an old result page.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  // Spotlight layout (May 16 2026 redesign):
  //   1. Compact HeaderStrip — logo + mode pills + AE badge in one line
  //   2. AE banner (only when NOT connected — prompts the user to auth)
  //   3. Active mode section (the tool itself, full focus)
  //   4. Recent hunts strip (only on Manual mode, click to prefill)
  return (
    <div className="relative max-w-5xl mx-auto space-y-5 pb-12">
      <HeaderStrip active={activeTab} onChange={setActiveTab} />

      <AliExpressConnectionBanner compactWhenConnected />

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

      {/* Recent hunts only on Manual Hunting — the other modes are
          input-driven (URL / image) and don't benefit from a history
          carousel yet. */}
      {activeTab === "manual" && <RecentHuntsStrip onPick={handlePickRecent} />}
    </div>
  );
}

// ─── Header strip (Spotlight layout, May 16 2026) ───────────────────
//
// One-line header that combines what used to be a 350px-tall
// HeroBanner + a 4-card ToolTabsBar + AE banner. Saves ~280px of
// vertical space so the actual tool (the niche input) lands above
// the fold on every screen size.
//
// Layout:
//   [logo · "Product Hunter"]   [Manual] [Reverse] [Image] [Soon]   [✓ AE]
//
// On narrow screens the mode tabs wrap to a second row underneath.

const MODE_TABS: Array<{
  id: HunterTab;
  label: string;
  icon: typeof Target;
  gradient: string;
}> = [
  {
    id: "manual",
    label: "Manual Hunting",
    icon: Target,
    gradient: "from-sky-500 to-violet-500",
  },
  {
    id: "reverse",
    label: "Reverse Hunt",
    icon: Link2,
    gradient: "from-emerald-500 to-orange-500",
  },
  {
    id: "image",
    label: "Image Hunt",
    icon: ImageIcon,
    gradient: "from-violet-500 to-pink-500",
  },
  {
    id: "soon",
    label: "More Soon",
    icon: LayoutGrid,
    gradient: "from-amber-500 to-rose-500",
  },
];

function HeaderStrip({
  active,
  onChange,
}: {
  active: HunterTab;
  onChange: (t: HunterTab) => void;
}) {
  return (
    <div className="relative ap-stagger-in">
      <div className="rounded-2xl bg-card/95 ring-1 ring-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_12px_36px_-12px_rgba(0,0,0,0.5)] p-3 sm:p-3.5">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          {/* Logo + name */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative">
              <span
                aria-hidden
                className="absolute -inset-1 rounded-xl bg-gradient-to-br from-sky-400/30 to-violet-500/30 blur-md"
              />
              <div className="relative size-9 rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 ring-1 ring-violet-700/30 flex items-center justify-center shadow-md shadow-violet-500/25">
                <Target className="size-4 text-white" />
              </div>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground leading-tight">
                Hunting hub
              </p>
              <h1 className="text-[15px] font-bold tracking-tight leading-tight">
                Product Hunter
              </h1>
            </div>
          </div>

          {/* Mode tabs — flex-1 row, wraps on mobile */}
          <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto pb-0.5 snap-x">
            {MODE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChange(tab.id)}
                  className={`relative shrink-0 snap-start inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg ring-1 transition-all overflow-hidden text-[11px] font-bold tracking-tight ${
                    isActive
                      ? "ring-foreground/30 bg-card shadow"
                      : "ring-border/40 bg-muted/15 hover:ring-border hover:bg-muted/30 text-foreground/75"
                  }`}
                >
                  {isActive && (
                    <span
                      aria-hidden
                      className={`absolute inset-0 bg-gradient-to-br ${tab.gradient} opacity-[0.08]`}
                    />
                  )}
                  <Icon
                    className={`relative size-3 ${
                      isActive ? "text-foreground" : "text-muted-foreground"
                    }`}
                  />
                  <span className="relative">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* AE compact badge sits on the far right — rendered by
              AliExpressConnectionBanner itself when connected (compact
              mode). When disconnected, the full banner renders below. */}
        </div>
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
  compactWhenConnected = false,
}: {
  compactWhenConnected?: boolean;
}) {
  const [status, setStatus] = useState<AliConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return null;

  if (!status || !status.connected) {
    return (
      <Card className="border border-orange-300/50 dark:border-orange-700/40 bg-orange-50/40 dark:bg-orange-950/15 shadow-none">
        <CardContent className="p-4 flex items-center gap-3 flex-wrap">
          <div className="size-9 rounded-xl bg-orange-500/15 ring-1 ring-orange-500/30 flex items-center justify-center shrink-0">
            <Plug className="size-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold leading-tight">
              Connect AliExpress to unlock full-loop hunting
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              One-time authorization. Once connected, every keyword expands to a
              ranked AliExpress product list — no more browsing aliexpress.com manually.
            </p>
          </div>
          <a
            href="/api/aliexpress/auth-start"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-bold tracking-wide bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow-md shadow-orange-500/30 hover:opacity-90 transition-opacity"
          >
            <Plug className="size-3.5" />
            Connect AliExpress
          </a>
        </CardContent>
      </Card>
    );
  }

  // Connected
  const disconnect = async () => {
    if (!confirm("Disconnect AliExpress? You'll need to re-authorize."))
      return;
    await fetch("/api/aliexpress/disconnect", { method: "POST" });
    setStatus({ connected: false });
    toast.success("Disconnected from AliExpress");
  };

  // In the Spotlight layout the AE-connected state collapses to a
  // single-line ultra-compact strip so it doesn't compete with the
  // tool input below. When disconnected we always show the full
  // CTA banner because the user needs to act.
  if (compactWhenConnected) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-emerald-50/40 dark:bg-emerald-950/10 ring-1 ring-emerald-300/40 dark:ring-emerald-700/30 text-[11px]">
        <div className="inline-flex items-center gap-1.5 min-w-0">
          <Check
            className="size-3 text-emerald-600 dark:text-emerald-400"
            strokeWidth={3}
          />
          <span className="font-bold text-emerald-700 dark:text-emerald-300">
            AliExpress connected
          </span>
          {status.aliUserNick && (
            <span className="text-muted-foreground truncate">
              · {status.aliUserNick}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={disconnect}
          className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors shrink-0"
        >
          Disconnect
        </button>
      </div>
    );
  }

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
        <button
          type="button"
          onClick={disconnect}
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 hover:text-foreground"
        >
          Disconnect
        </button>
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
