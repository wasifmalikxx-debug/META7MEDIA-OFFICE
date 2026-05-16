"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Flame,
  Hourglass,
  Sparkles,
  Bookmark,
  TrendingUp,
  Crown,
  CheckCircle2,
} from "lucide-react";

/**
 * Pre-launch placeholder for /daily-trending.
 *
 * Shown to roles outside the Etsy team (HR, Facebook, Zain). The
 * tool itself is gated to Etsy sellers since it's their workflow.
 * Visual family matches the other "Coming Soon" placeholders
 * (Product Hunter, Reverse Hunt) for consistency.
 */
export function DailyTrendingComingSoon() {
  const features = [
    {
      icon: Bookmark,
      title: "Pick your niches",
      copy: "Add up to 5 niches you work — boho jewelry, cottagecore decor, whatever your shop sells. Edit any time.",
    },
    {
      icon: Flame,
      title: "Fresh batch every morning",
      copy: "Cron runs at 5 AM PKT and pulls the day's hottest AliExpress products in your niches. Yesterday's batch clears.",
    },
    {
      icon: Sparkles,
      title: "One-click sourcing",
      copy: "Open AE, get a calculator-ready price, or jump into Product Hunter to brainstorm Etsy keywords — all from the card.",
    },
    {
      icon: TrendingUp,
      title: "Claim before others",
      copy: "Spotted a winner? Click Claim — the rest of the team sees it's yours so nobody races you to the same listing.",
    },
  ];

  return (
    <div className="relative max-w-5xl mx-auto space-y-6 pb-12">
      {/* ─────────────── Hero ─────────────── */}
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-orange-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#2a0d10] via-[#26121a] to-[#0d0d2a]" />
        <div
          aria-hidden
          className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(251,146,60,0.35), rgba(251,146,60,0) 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(244,63,94,0.35), rgba(244,63,94,0) 70%)",
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
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/30 bg-orange-500/15 backdrop-blur-md px-3 py-1 mb-6">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-300 opacity-80" />
              <span className="relative inline-flex size-1.5 rounded-full bg-orange-300" />
            </span>
            <span className="text-[10px] font-bold text-orange-100 uppercase tracking-[0.18em]">
              Coming Soon · Etsy team
            </span>
          </div>

          <div className="relative inline-flex mb-4">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-orange-400/40 to-rose-500/40 blur-lg"
            />
            <div className="relative size-14 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-orange-900/40">
              <Flame className="size-7 text-white drop-shadow-lg" />
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.1]">
            Daily Trending
          </h1>
          <p className="mt-3 text-[13px] sm:text-sm text-white/75 max-w-xl mx-auto leading-relaxed">
            A morning feed of the hottest{" "}
            <strong className="text-white font-semibold">AliExpress</strong>{" "}
            products in each Etsy seller&apos;s niches — list them before
            anyone else does.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 text-xs text-white/65">
            <Hourglass className="size-3.5" />
            <span>Built for the Etsy sellers · launching soon</span>
          </div>
        </div>
      </div>

      {/* ─────────────── Feature grid ─────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em]">
            How it works
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="border border-border/60 shadow-none">
                <CardContent className="p-5">
                  <div className="size-10 rounded-xl bg-gradient-to-br from-orange-500/15 to-rose-500/15 ring-1 ring-orange-500/20 flex items-center justify-center mb-3">
                    <Icon className="size-4 text-orange-600 dark:text-orange-400" />
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

      {/* ─────────────── Access note ─────────────── */}
      <Card className="border border-amber-300/40 dark:border-amber-700/30 bg-amber-50/50 dark:bg-amber-950/15 shadow-none">
        <CardContent className="p-5 flex items-start gap-3">
          <div className="size-9 rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center shrink-0">
            <Crown className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200 leading-tight">
              Etsy sellers only
            </p>
            <p className="text-[12px] text-amber-800/85 dark:text-amber-200/80 mt-1 leading-relaxed">
              Daily Trending is built for the Etsy team (EM, AE, ME) and the
              Etsy partners. Other roles don&apos;t have a niche book.
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        <CheckCircle2 className="inline size-3 mr-1 -translate-y-px text-emerald-500" />
        Already built — launching to the team after CEO sign-off.
      </p>
    </div>
  );
}
