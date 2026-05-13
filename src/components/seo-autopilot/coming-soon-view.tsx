"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  CheckCircle2,
  Hourglass,
  Wand2,
  Tags,
  FileText,
  ShieldCheck,
  Layers,
  Zap,
} from "lucide-react";

/**
 * Pre-launch placeholder for SEO Autopilot.
 *
 * Two purposes:
 *  1. Tells the team the tool is coming (so they don't keep asking)
 *  2. Communicates exactly WHAT it will do so they know what to expect
 *     when it launches
 *
 * Replaced by the real generator UI once we ship Phase 1.
 */
export function SeoAutopilotComingSoon() {
  const features = [
    {
      icon: Wand2,
      title: "Smart title generation",
      copy: "Optimized 140-character Etsy titles — built around keywords from live ranking listings.",
    },
    {
      icon: Tags,
      title: "13 fresh tags",
      copy: "Pulled from real-time Etsy data — no recycled ChatGPT phrases.",
    },
    {
      icon: FileText,
      title: "Full SEO description",
      copy: "Structured, keyword-rich, Etsy-friendly copy that converts.",
    },
    {
      icon: Layers,
      title: "Category-specific attributes",
      copy: "Material, style, recipient, occasion — all pre-filled per Etsy's rules for the category.",
    },
    {
      icon: ShieldCheck,
      title: "Policy compliance check",
      copy: "Flags trademark, IP, and prohibited-content risks before you publish.",
    },
    {
      icon: Zap,
      title: "Powered by Claude + live Etsy data",
      copy: "Real ranking signals, not generic AI guesses. Built for the team.",
    },
  ];

  return (
    <div className="space-y-6">
      {/* ─────────────── Hero card ─────────────── */}
      <Card className="border shadow-none overflow-hidden relative">
        {/* Soft gradient + glow background */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-violet-50 via-card to-emerald-50/40 dark:from-violet-950/30 dark:via-card dark:to-emerald-950/20 pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute -top-20 -left-20 size-64 rounded-full bg-violet-300/30 dark:bg-violet-700/20 blur-3xl pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute -bottom-20 -right-20 size-64 rounded-full bg-emerald-300/30 dark:bg-emerald-700/20 blur-3xl pointer-events-none"
        />

        <CardContent className="relative py-14 sm:py-20 px-6 sm:px-10 text-center">
          {/* Status pill */}
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/50 bg-violet-50/70 dark:bg-violet-950/40 dark:border-violet-700/40 px-3 py-1 mb-6 shadow-sm">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-violet-500" />
            </span>
            <span className="text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase tracking-[0.18em]">
              Coming Soon
            </span>
          </div>

          {/* Headline */}
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-violet-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Sparkles className="size-6 text-white" />
            </div>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">
            SEO Autopilot
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
            One brief. One click. A complete, policy-safe Etsy listing —
            title, tags, description, and every required attribute —
            generated from <strong className="text-foreground font-semibold">live Etsy ranking data</strong>{" "}
            + <strong className="text-foreground font-semibold">Claude AI</strong>.
          </p>

          {/* Status indicator */}
          <div className="mt-6 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Hourglass className="size-3.5" />
            <span>Currently in build · launching soon</span>
          </div>
        </CardContent>
      </Card>

      {/* ─────────────── Feature grid ─────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em]">
            What it will do
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="border shadow-none">
                <CardContent className="p-4 sm:p-5">
                  <div className="size-9 rounded-lg bg-muted/60 dark:bg-muted/40 flex items-center justify-center mb-3">
                    <Icon className="size-4 text-foreground/70" />
                  </div>
                  <h3 className="text-sm font-semibold mb-1 leading-tight">
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

      {/* ─────────────── How it works strip ─────────────── */}
      <Card className="border shadow-none">
        <CardContent className="p-5 sm:p-6">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em] mb-4">
            How it&apos;ll work
          </p>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Step
              n={1}
              title="Paste the basics"
              body="Product brief, AliExpress title, key specs."
            />
            <Step
              n={2}
              title="Pick category"
              body="Tool auto-suggests the right Etsy category — you confirm."
            />
            <Step
              n={3}
              title="AI generates"
              body="Title, 13 tags, full description, attributes — using live Etsy ranking data."
            />
            <Step
              n={4}
              title="Copy & paste"
              body="Each field has a copy button. Paste into Etsy. Done."
            />
          </ol>
        </CardContent>
      </Card>

      {/* ─────────────── Footer note ─────────────── */}
      <p className="text-center text-[11px] text-muted-foreground">
        <CheckCircle2 className="inline size-3 mr-1 -translate-y-px text-emerald-500" />
        Approved access: visible because you&apos;re on the Etsy team. You&apos;ll be notified the moment it&apos;s live.
      </p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="relative pl-9">
      <span className="absolute left-0 top-0 size-7 rounded-full bg-foreground/90 text-background text-[11px] font-bold flex items-center justify-center tabular-nums">
        {n}
      </span>
      <p className="text-xs font-semibold leading-tight">{title}</p>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
        {body}
      </p>
    </li>
  );
}
