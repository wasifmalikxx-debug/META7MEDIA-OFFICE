"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Check,
  TrendingUp,
  Target,
  Heart,
  Plug,
  X,
  Crown,
  Gauge,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Product Hunter — full-bleed themed hero (May 18 2026).
 *
 * Matches the family the rest of the Etsy Tools use (Calculator,
 * Product Validator, SEO Autopilot) — dark gradient + animated aurora
 * blobs + dot pattern + status pills + icon-with-orb-glow + title +
 * 3 stat cells — with a COOL navy/cyan/violet palette to differentiate:
 *
 *   - SEO Autopilot     → warm purple → orange (creative AI)
 *   - Product Hunter    → cool navy → cyan/violet (discovery / hunt)
 *   - Price Calculator  → deep teal → emerald (money / margin)
 *   - Product Validator → deep violet → emerald (safety / policy)
 *
 * Self-contained: owns its own AE-status fetch, quota chip, URL
 * cleanup, and AE-connect UI. The parent view doesn't need to plumb
 * any state in. After every successful hunt the ManualHuntingSection
 * dispatches a `productHunter:huntComplete` window event; this hero
 * listens for it and refetches the quota chip so the count stays in
 * sync without a full reload.
 *
 * Full-bleed: caller wraps this in `-mx-4 md:-mx-6 -mt-4 md:-mt-6` to
 * escape the dashboard <main>'s padding. Inner content is capped at
 * max-w-5xl so headlines don't sprawl on ultrawide displays.
 */

// ─── Types ──────────────────────────────────────────────────────────

interface UsageSummary {
  count: number;
  limit: number;
  remaining: number;
  resetAt: string;
  isUnlimited: boolean;
  date: string;
}

interface AliConnectionStatus {
  connected: boolean;
  expired?: boolean;
  aliUserNick?: string | null;
  aliUserId?: string | null;
  expiresAt?: string;
  connectedAt?: string;
}

/** Custom event name fired by ManualHuntingSection after each
 * successful hunt so the hero can refresh its quota chip. */
export const HUNT_COMPLETE_EVENT = "productHunter:huntComplete";

// ─── Stat cells row ─────────────────────────────────────────────────

const HERO_CELLS: Array<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}> = [
  { icon: Sparkles, label: "25 variants", sub: "Claude brainstorm" },
  { icon: TrendingUp, label: "Live Etsy", sub: "Demand · favorites · shops" },
  { icon: Heart, label: "Ranked", sub: "GREAT · GOOD · MAYBE · SKIP" },
];

// ─── Main hero ──────────────────────────────────────────────────────

export function ProductHunterHero({
  userRole,
}: {
  userRole: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  // Daily quota — fetched on mount + refetched after every hunt
  // (ManualHuntingSection fires HUNT_COMPLETE_EVENT, we listen).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/seo-autopilot/hunt-usage", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.usage) setUsage(data.usage);
      } catch {
        /* silent — chip just doesn't render */
      }
    };
    load();
    const onHuntComplete = () => load();
    window.addEventListener(HUNT_COMPLETE_EVENT, onHuntComplete);
    return () => {
      cancelled = true;
      window.removeEventListener(HUNT_COMPLETE_EVENT, onHuntComplete);
    };
  }, []);

  // Strip ?aliConnect= / ?reason= / ?niche= from the URL on first
  // mount so subsequent reloads don't re-fire the OAuth-completion
  // toast or hijack the niche input downstream. Lives here in the
  // always-rendered hero rather than in the AE pill (which returns
  // null for EM/AE/ME viewers and would leave the params stuck).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("aliConnect");
    let dirty = false;
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
      dirty = true;
    }
    if (url.searchParams.has("niche")) {
      url.searchParams.delete("niche");
      dirty = true;
    }
    if (dirty) {
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  return (
    <div className="relative overflow-hidden shadow-xl shadow-violet-500/15 ap-stagger-in border-b border-white/10">
      {/* Base gradient — cool navy → violet → navy */}
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

      <div className="relative max-w-5xl mx-auto px-7 sm:px-9 py-8 sm:py-10">
        {/* Status pills row */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20 shadow-inner">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            Etsy team · Live
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/90 tracking-[0.16em] uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
            <Sparkles className="size-3" />
            Hunting hub
          </span>
          {usage && <UsagePill usage={usage} />}
          <AliExpressHeaderPill userRole={userRole} />
        </div>

        {/* Icon + title */}
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
          </div>
        </div>

        {/* Stat cells row */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          {HERO_CELLS.map((cell) => (
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

// ─── Feature cell (bottom of hero) ──────────────────────────────────

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
        <p className="text-[10px] text-white/55 leading-tight truncate">
          {sub}
        </p>
      </div>
    </div>
  );
}

// ─── Daily quota pill ───────────────────────────────────────────────

function UsagePill({ usage }: { usage: UsageSummary }) {
  if (usage.isUnlimited) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px] font-bold text-violet-100 tracking-[0.16em] uppercase bg-violet-500/25 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-violet-300/30"
        title="CEO — no daily cap"
      >
        <Crown className="size-3" />
        Unlimited
      </span>
    );
  }
  const remaining = Math.max(0, usage.remaining);
  const ratio = usage.count / Math.max(1, usage.limit);
  const tone =
    remaining === 0 ? "rose" : ratio >= 0.8 ? "amber" : "emerald";
  const cls = {
    rose: "bg-rose-500/25 text-rose-100 ring-rose-300/30",
    amber: "bg-amber-500/25 text-amber-100 ring-amber-300/30",
    emerald: "bg-emerald-500/25 text-emerald-100 ring-emerald-300/30",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] uppercase backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ${cls}`}
      title={`${usage.count} of ${usage.limit} hunts today (resets at midnight PKT)`}
    >
      <Gauge className="size-3" />
      {remaining === 0
        ? "Daily limit reached"
        : `${usage.count} / ${usage.limit} today`}
    </span>
  );
}

// ─── AliExpress connection pill ─────────────────────────────────────
//
// Role behaviour:
//   - SUPER_ADMIN (CEO): connected → green pill with × disconnect;
//                        disconnected → orange Connect link
//   - PARTNER: connected → green status-only pill;
//              disconnected → orange "ask the CEO" info pill
//   - everyone else: nothing (the tool just works via CEO's token)

function AliExpressHeaderPill({
  userRole,
}: {
  userRole: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  const [status, setStatus] = useState<AliConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Hooks first, role gate after.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/aliexpress/status");
        if (!res.ok) return;
        const data = (await res.json()) as AliConnectionStatus;
        if (!cancelled) setStatus(data);
      } catch {
        /* banner just won't render */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const isCeo = userRole === "SUPER_ADMIN";
  const isPartner = userRole === "PARTNER";
  if (!isCeo && !isPartner) return null;
  if (loading) return null;

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
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px] font-bold text-orange-100 tracking-[0.16em] uppercase bg-orange-500/20 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-orange-300/30"
        title="AliExpress not connected — only the CEO can attach an account"
      >
        <Plug className="size-3" />
        AE off · ask the CEO
      </span>
    );
  }

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
