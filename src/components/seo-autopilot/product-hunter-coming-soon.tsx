"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Target,
  Hourglass,
  Sparkles,
  TrendingUp,
  Search,
  Lightbulb,
  Crown,
  CheckCircle2,
} from "lucide-react";

/**
 * Pre-launch placeholder for Product Hunter.
 *
 * Shown to non-CEO SEO Autopilot users (Izaan, EM employees, Etsy
 * partners) so the team knows the tool is on the roadmap. The actual
 * tool stays CEO-only while Wasif validates the picks.
 */
export function ProductHunterComingSoon() {
  const features = [
    {
      icon: Search,
      title: "Seed a category",
      copy: "Paste a product type — wallets, phone cases, linen pants — and let the hunter expand it.",
    },
    {
      icon: Sparkles,
      title: "25 long-tail variants",
      copy: "Claude brainstorms angles you'd never think of. Specific, niche, rankable.",
    },
    {
      icon: TrendingUp,
      title: "Live Etsy demand",
      copy: "Real-time signal — total listings, top-10 favorites, unique shops in the rankings.",
    },
    {
      icon: Lightbulb,
      title: "Scored & ranked",
      copy: "Composite score across demand, engagement, shop diversity, and long-tail bonus.",
    },
  ];

  return (
    <div className="relative max-w-5xl mx-auto space-y-6 pb-12">
      {/* ─────────────── Hero ─────────────── */}
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-violet-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1a2a] via-[#1a1226] to-[#0d1a2a]" />
        <div
          aria-hidden
          className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(34,211,238,0.35), rgba(34,211,238,0) 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(168,85,247,0.35), rgba(168,85,247,0) 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        />

        <div className="relative px-7 sm:px-9 py-10 sm:py-14 text-center">
          {/* Status pill */}
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/30 bg-violet-500/15 backdrop-blur-md px-3 py-1 mb-6">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-300 opacity-80" />
              <span className="relative inline-flex size-1.5 rounded-full bg-violet-300" />
            </span>
            <span className="text-[10px] font-bold text-violet-100 uppercase tracking-[0.18em]">
              Coming Soon · For the team
            </span>
          </div>

          {/* Icon */}
          <div className="relative inline-flex mb-4">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-sky-400/40 to-violet-500/40 blur-lg"
            />
            <div className="relative size-14 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-sky-900/40">
              <Target className="size-7 text-white drop-shadow-lg" />
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.1]">
            Product Hunter
          </h1>
          <p className="mt-3 text-[13px] sm:text-sm text-white/75 max-w-xl mx-auto leading-relaxed">
            We&apos;re building a tool that finds underserved Etsy niches{" "}
            <strong className="text-white font-semibold">before</strong> you
            hunt AliExpress — so you stop wasting hours on saturated keywords.
          </p>

          {/* Status indicator */}
          <div className="mt-6 inline-flex items-center gap-2 text-xs text-white/65">
            <Hourglass className="size-3.5" />
            <span>CEO validating picks · launching to the team soon</span>
          </div>
        </div>
      </div>

      {/* ─────────────── Feature grid ─────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em]">
            What it will do for you
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="border border-border/60 shadow-none">
                <CardContent className="p-5">
                  <div className="size-10 rounded-xl bg-gradient-to-br from-sky-500/15 to-violet-500/15 ring-1 ring-violet-500/20 flex items-center justify-center mb-3">
                    <Icon className="size-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <h3 className="text-sm font-bold mb-1 leading-tight">
                    {f.title}
                  </h3>
                  <p className="text-[12px] text-muted-foreground leading-snug">
                    {f.copy}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ─────────────── Why it matters ─────────────── */}
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-6">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em] mb-3">
            Why we&apos;re building this
          </p>
          <p className="text-[13px] leading-relaxed text-foreground/85">
            Right now the team spends hours scrolling AliExpress, picking
            products, then finding out they&apos;re already saturated on Etsy.
            Product Hunter flips the order — start from the{" "}
            <strong>Etsy demand signal</strong>, then hunt AliExpress for the
            matching product. Less guesswork, fewer dead listings, more wins.
          </p>
        </CardContent>
      </Card>

      {/* ─────────────── Access note ─────────────── */}
      <Card className="border border-amber-300/40 dark:border-amber-700/30 bg-amber-50/50 dark:bg-amber-950/15 shadow-none">
        <CardContent className="p-5 flex items-start gap-3">
          <div className="size-9 rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center shrink-0">
            <Crown className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200 leading-tight">
              CEO-led pilot first
            </p>
            <p className="text-[12px] text-amber-800/85 dark:text-amber-200/80 mt-1 leading-relaxed">
              The CEO is running the early scans personally to validate
              which niche signals actually translate into AliExpress
              wins. Once the picks are proven, the tool opens up to the
              team.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Footer note */}
      <p className="text-center text-[11px] text-muted-foreground">
        <CheckCircle2 className="inline size-3 mr-1 -translate-y-px text-emerald-500" />
        You&apos;ll be notified the moment Product Hunter goes live for the team.
      </p>
    </div>
  );
}
