"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  Eye,
  Search,
  PenLine,
  Crown,
  Gauge,
} from "lucide-react";

/**
 * SEO Autopilot — full-bleed themed hero (May 18 2026).
 *
 * Matches the family the rest of the Etsy Tools use (Price Calculator,
 * Product Validator, Product Hunter) — dark gradient + animated aurora
 * blobs + dot pattern + status pills + icon-with-orb-glow + title +
 * 3 stat cells — with a WARM purple/orange palette for the creative-AI
 * brand signature:
 *
 *   - SEO Autopilot     → warm purple → orange (creative AI)
 *   - Product Hunter    → cool navy → cyan/violet (discovery / hunt)
 *   - Price Calculator  → deep teal → emerald (money / margin)
 *   - Product Validator → deep violet → emerald (safety / policy)
 *
 * Self-contained: owns its own quota chip fetch. After every successful
 * generation the view dispatches a `seoAutopilot:genComplete` window
 * event; this hero listens for it and refetches the quota chip so the
 * count stays in sync without a full reload.
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

/** Custom event the view dispatches after each successful generation
 * so the hero refreshes its quota chip. */
export const GEN_COMPLETE_EVENT = "seoAutopilot:genComplete";

// ─── Stat cells row ─────────────────────────────────────────────────

const HERO_CELLS: Array<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}> = [
  { icon: Eye, label: "Compliance", sub: "Etsy policy gate" },
  { icon: Search, label: "Research", sub: "20 top listings" },
  { icon: PenLine, label: "Writes copy", sub: "Title · tags · desc" },
];

// ─── Main hero ──────────────────────────────────────────────────────

export function SeoAutopilotHero() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/seo-autopilot/usage", {
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
    const onGenComplete = () => load();
    window.addEventListener(GEN_COMPLETE_EVENT, onGenComplete);
    return () => {
      cancelled = true;
      window.removeEventListener(GEN_COMPLETE_EVENT, onGenComplete);
    };
  }, []);

  return (
    <div className="relative overflow-hidden shadow-xl shadow-orange-500/15 ap-stagger-in border-b border-white/10">
      {/* Base gradient — warm purple → orange (the SEO Autopilot
          brand palette, distinguishing it from the cool / emerald /
          violet of the other three Etsy Tools). */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a0d1f] via-[#2a1612] to-[#1a0d1f]" />

      {/* Animated aurora blobs */}
      <div
        aria-hidden
        className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl ap-aurora-1"
        style={{
          background:
            "radial-gradient(closest-side, rgba(241,100,30,0.85), rgba(241,100,30,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl ap-aurora-2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(124,58,237,0.75), rgba(124,58,237,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-1/3 right-1/4 size-[300px] rounded-full blur-3xl ap-aurora-3"
        style={{
          background:
            "radial-gradient(closest-side, rgba(244,114,182,0.55), rgba(244,114,182,0) 70%)",
        }}
      />

      {/* Dot pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />

      {/* Top highlight */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />

      <div className="relative max-w-5xl mx-auto px-7 sm:px-9 py-8 sm:py-10">
        {/* Status pills row — same shape as the Calculator / Validator /
            Hunter heroes: live + scope pill + quota. The previous
            generating / listing-ready pills moved out of the hero
            (they were transient state better expressed by the cinema
            and result panel themselves). */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20 shadow-inner">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            Etsy team · Live
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/90 tracking-[0.16em] uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
            <ShieldCheck className="size-3" />
            Policy-safe listing
          </span>
          {usage && <UsagePill usage={usage} />}
        </div>

        {/* Icon + title */}
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-orange-400/40 to-violet-500/40 blur-lg ap-orb-pulse"
            />
            <div className="relative size-16 sm:size-[68px] rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-orange-900/40">
              <Sparkles className="size-7 sm:size-8 text-white drop-shadow-lg" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.05]">
              SEO Autopilot
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
      title={`${usage.count} of ${usage.limit} generations today (resets at midnight PKT)`}
    >
      <Gauge className="size-3" />
      {remaining === 0
        ? "Daily limit reached"
        : `${usage.count} / ${usage.limit} today`}
    </span>
  );
}
