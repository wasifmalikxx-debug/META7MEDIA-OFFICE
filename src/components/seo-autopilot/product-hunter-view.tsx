"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  Check,
  TrendingUp,
  Target,
  Lightbulb,
  Zap,
  Heart,
  Plug,
  ShoppingBag,
  Link2,
  Image as ImageIcon,
  Hourglass,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";
import { ReverseHuntSection } from "./reverse-hunt-section";
import { ImageHuntSection } from "./image-hunt-section";
import { ManualHuntingSection } from "./manual-hunting-section";

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

  return (
    <div className="relative max-w-5xl mx-auto space-y-6 pb-12">
      <HeroBanner activeTab={activeTab} />
      <AliExpressConnectionBanner />
      <ToolTabsBar active={activeTab} onChange={setActiveTab} />

      {/* Manual Hunting — niche → categories → keywords → AE preview */}
      {activeTab === "manual" && <ManualHuntingSection />}

      {/* Reverse Hunt — paste AE URL → Etsy verdict + margin */}
      {activeTab === "reverse" && <ReverseHuntSection isCeo={true} />}

      {/* Image Hunt — paste image URL → similar AE products */}
      {activeTab === "image" && <ImageHuntSection />}

      {/* Coming Soon roadmap */}
      {activeTab === "soon" && <ComingSoonRoadmap />}
    </div>
  );
}

// ─── Tool tabs bar ──────────────────────────────────────────────────

/**
 * Pill-style tab bar that switches between hunting tools.
 *
 * Every tab keeps its own state inside its child component, so flipping
 * back to "Manual Hunting" preserves any in-progress scan results. Same
 * for Reverse / Image. Coming Soon is static.
 */
function ToolTabsBar({
  active,
  onChange,
}: {
  active: HunterTab;
  onChange: (t: HunterTab) => void;
}) {
  const tabs: Array<{
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

  return (
    <div className="relative">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {tabs.map((tab) => {
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

// ─── Hero banner ────────────────────────────────────────────────────

const TAB_COPY: Record<
  HunterTab,
  { description: string; cells: Array<{ icon: typeof Zap; label: string; sub: string }> }
> = {
  manual: {
    description:
      "Manual hunting — type a seed product type or niche, we brainstorm 25 long-tail variants and score each one against live Etsy demand, engagement, and shop diversity. You stay in control; the system surfaces the angles worth listing.",
    cells: [
      { icon: Zap, label: "25 variants", sub: "Haiku brainstorm" },
      { icon: TrendingUp, label: "Live Etsy", sub: "Demand · favorites · shops" },
      { icon: Lightbulb, label: "Ranked", sub: "GREAT · GOOD · MAYBE · SKIP" },
    ],
  },
  reverse: {
    description:
      "Already eyeing a product on AliExpress? Paste the link — we'll fetch it, check Etsy demand, project your margin, and tell you in plain English: source it or skip it.",
    cells: [
      { icon: ShoppingBag, label: "AE source", sub: "Live price + rating" },
      { icon: TrendingUp, label: "Etsy demand", sub: "Listings + favorites" },
      { icon: Lightbulb, label: "Verdict", sub: "STRONG YES · YES · MAYBE · NO" },
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
    <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-violet-500/20 ap-stagger-in">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d1a2a] via-[#1a1226] to-[#0d1a2a]" />
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

      <div className="relative px-7 sm:px-9 py-8 sm:py-10">
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


// ─── AliExpress connection banner ───────────────────────────────────

interface AliConnectionStatus {
  connected: boolean;
  expired?: boolean;
  aliUserNick?: string | null;
  aliUserId?: string | null;
  expiresAt?: string;
  connectedAt?: string;
}

function AliExpressConnectionBanner() {
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

  // Connected — compact green strip
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
          onClick={async () => {
            if (!confirm("Disconnect AliExpress? You'll need to re-authorize."))
              return;
            await fetch("/api/aliexpress/disconnect", { method: "POST" });
            setStatus({ connected: false });
            toast.success("Disconnected from AliExpress");
          }}
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 hover:text-foreground"
        >
          Disconnect
        </button>
      </CardContent>
    </Card>
  );
}
