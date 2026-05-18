"use client";

import { ShieldCheck, Sparkles, Link2, FileCheck2 } from "lucide-react";

/**
 * Product Validator — full-bleed themed hero (May 18 2026).
 *
 * Matches the family the rest of the Etsy Tools use (Calculator,
 * Product Hunter, SEO Autopilot) — dark gradient + animated aurora
 * blobs + dot pattern + status pills + icon-with-orb-glow + title +
 * 3 stat cells — but uses a VIOLET / EMERALD palette to differentiate:
 *
 *   - SEO Autopilot     → warm purple → orange (creative AI)
 *   - Product Hunter    → cool navy → cyan/violet (discovery / hunt)
 *   - Price Calculator  → deep teal → emerald (money / margin)
 *   - Product Validator → deep violet → emerald (safety / policy)
 *
 * Full-bleed: caller wraps this in `-mx-4 md:-mx-6 -mt-4 md:-mt-6` to
 * escape the dashboard <main>'s padding. Inner content is capped at
 * max-w-5xl so headlines don't sprawl on ultrawide displays.
 */
export function ProductValidatorHero() {
  return (
    <div className="relative overflow-hidden shadow-xl shadow-violet-500/15 ap-stagger-in border-b border-white/10">
      {/* Base gradient — deep violet → dark navy → deep emerald */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a0d2a] via-[#0d1a26] to-[#0d2a1f]" />

      {/* Animated aurora blobs — violet + emerald */}
      <div
        aria-hidden
        className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl ap-aurora-1"
        style={{
          background:
            "radial-gradient(closest-side, rgba(168,85,247,0.55), rgba(168,85,247,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl ap-aurora-2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(16,185,129,0.55), rgba(16,185,129,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-1/3 right-1/4 size-[300px] rounded-full blur-3xl ap-aurora-3"
        style={{
          background:
            "radial-gradient(closest-side, rgba(139,92,246,0.35), rgba(139,92,246,0) 70%)",
        }}
      />

      {/* Subtle dot pattern for texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />

      {/* Top highlight for depth */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />

      <div className="relative max-w-5xl mx-auto px-7 sm:px-9 py-8 sm:py-10">
        {/* Status pills — match calculator's pattern exactly:
            "Etsy team · Live" (green pulsing dot) + secondary scope pill */}
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
            Policy gate
          </span>
        </div>

        {/* Icon + title */}
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-violet-400/40 to-emerald-500/40 blur-lg ap-orb-pulse"
            />
            <div className="relative size-16 sm:size-[68px] rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-violet-900/40">
              <ShieldCheck className="size-7 sm:size-8 text-white drop-shadow-lg" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.05]">
              Product Validator
            </h1>
            {/* No body copy — matches Calculator + Product Hunter +
                SEO Autopilot (CEO removed descriptive paragraphs from
                the heroes). */}
          </div>
        </div>

        {/* Stat cells row — 3 features summarising the tool's scope.
            Mirrors the calculator's AE-cost / Stepped-markup / Etsy-
            price-out trio at the bottom of its hero. */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          <FeatureCell
            icon={Link2}
            label="Aliexpress.com URLs"
            sub="Regional storefronts not supported"
          />
          <FeatureCell
            icon={ShieldCheck}
            label="Etsy policy coverage"
            sub="Prohibited · IP · PPE · Creativity"
          />
          <FeatureCell
            icon={FileCheck2}
            label="Clear verdict"
            sub="Safe · Listable · Flagged"
          />
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
        <p className="text-[10px] text-white/55 leading-tight truncate">
          {sub}
        </p>
      </div>
    </div>
  );
}
