"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Link2,
  Hourglass,
  TrendingUp,
  ShoppingBag,
  Lightbulb,
  Crown,
  CheckCircle2,
  Image as ImageIcon,
} from "lucide-react";

/**
 * Pre-launch placeholder for Reverse Hunt.
 *
 * Shown to non-CEO SEO Autopilot users (Izaan, EM employees, Etsy
 * partners). CEO sees the real tool while validating the verdict
 * accuracy with real listings; team gets access once it's proven.
 */
export function ReverseHuntComingSoon() {
  const features = [
    {
      icon: Link2,
      title: "Paste an AliExpress link",
      copy: "Drop any AliExpress product URL — we fetch the live price, title, images, and rating.",
    },
    {
      icon: TrendingUp,
      title: "Auto-check Etsy demand",
      copy: "We search Etsy for matching listings to see if buyers actually want this product.",
    },
    {
      icon: ShoppingBag,
      title: "Projected margin",
      copy: "Live AliExpress cost + our markup table = exact $/sale before you commit hours.",
    },
    {
      icon: Lightbulb,
      title: "Plain-English verdict",
      copy: "STRONG YES · YES · MAYBE · NO. No more 'I spent 2 hours on this and it doesn't sell.'",
    },
  ];

  return (
    <div className="relative max-w-5xl mx-auto space-y-6 pb-12">
      {/* ─────────────── Hero ─────────────── */}
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-emerald-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1f1c] via-[#0d1a2a] to-[#1a1226]" />
        <div
          aria-hidden
          className="absolute -top-20 -left-20 size-[420px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(16,185,129,0.35), rgba(16,185,129,0) 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 right-0 size-[480px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(245,158,11,0.35), rgba(245,158,11,0) 70%)",
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
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-500/15 backdrop-blur-md px-3 py-1 mb-6">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-300" />
            </span>
            <span className="text-[10px] font-bold text-emerald-100 uppercase tracking-[0.18em]">
              Coming Soon · For the team
            </span>
          </div>

          <div className="relative inline-flex mb-4">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-emerald-400/40 to-orange-500/40 blur-lg"
            />
            <div className="relative size-14 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl">
              <Link2 className="size-7 text-white drop-shadow-lg" />
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.1]">
            Reverse Hunt
          </h1>
          <p className="mt-3 text-[13px] sm:text-sm text-white/75 max-w-xl mx-auto leading-relaxed">
            Paste an AliExpress product link and get a verdict in seconds —{" "}
            <strong className="text-white">source it</strong> or{" "}
            <strong className="text-white">skip it</strong>, with the
            projected margin baked in.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 text-xs text-white/65">
            <Hourglass className="size-3.5" />
            <span>CEO validating verdicts · launching to the team soon</span>
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
                  <div className="size-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-orange-500/15 ring-1 ring-emerald-500/20 flex items-center justify-center mb-3">
                    <Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
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
            You spot a product on AliExpress that looks promising. Currently
            you have to manually check Etsy for similar listings, compare
            prices, guess at margin — and half the time the verdict is wrong
            after two hours of work. Reverse Hunt does all of that in{" "}
            <strong>~5 seconds</strong>, with the demand signal pulled live
            from Etsy and the margin computed with our exact markup table.
          </p>
        </CardContent>
      </Card>

      {/* ─────────────── Bonus: image search ─────────────── */}
      <Card className="border border-violet-300/40 dark:border-violet-700/30 bg-violet-50/30 dark:bg-violet-950/15 shadow-none">
        <CardContent className="p-5 flex items-start gap-3">
          <div className="size-10 rounded-xl bg-violet-500/15 ring-1 ring-violet-500/30 flex items-center justify-center shrink-0">
            <ImageIcon className="size-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-violet-900 dark:text-violet-200 leading-tight">
              Bonus: image search
            </p>
            <p className="text-[12px] text-violet-800/85 dark:text-violet-200/80 mt-1 leading-relaxed">
              Same page will also have a &ldquo;By Image&rdquo; tab — paste a
              competitor&apos;s Etsy listing image and we find the AliExpress
              supplier that sells the exact same product.
            </p>
          </div>
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
              Wasif is running early hunts himself to validate that the
              verdicts actually predict real sales. Once the verdicts are
              proven, the tool opens up to the team.
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        <CheckCircle2 className="inline size-3 mr-1 -translate-y-px text-emerald-500" />
        You&apos;ll be notified the moment Reverse Hunt goes live for the team.
      </p>
    </div>
  );
}
