"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  ShieldCheck,
  Hourglass,
  Link2,
  Sparkles,
  CheckCircle2,
  Crown,
} from "lucide-react";

/**
 * Pre-launch placeholder for /product-validator.
 *
 * Shown to roles outside the Etsy team (HR, Facebook, Zain). The tool
 * is Etsy-seller-specific, so other roles see this informational view
 * but can't use it.
 */
export function ProductValidatorComingSoon() {
  const features = [
    {
      icon: Link2,
      title: "Paste an aliexpress.com URL",
      copy: "The validator accepts aliexpress.com product links. Sellers on the United States region should switch AliExpress to Pakistan to view the .com version of any product.",
    },
    {
      icon: ShieldCheck,
      title: "Full Etsy policy coverage",
      copy: "Runs every product against the Prohibited Items Policy, IP and Trademark rules, PPE policy, and Creativity Standards in a single pass.",
    },
    {
      icon: Sparkles,
      title: "Clear verdict per listing",
      copy: "Returns Safe, Review, or Do not list. Each flagged rule cites the exact Etsy policy clause that applies.",
    },
    {
      icon: CheckCircle2,
      title: "Built to prevent shop strikes",
      copy: "Surface policy violations before a product is listed — well before Etsy removes the listing and applies a strike to the shop record.",
    },
  ];

  return (
    <div className="relative max-w-5xl mx-auto space-y-6 pb-12">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-violet-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a0d2a] via-[#0d1a26] to-[#0d2a1f]" />
        <div
          aria-hidden
          className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(168,85,247,0.35), rgba(168,85,247,0) 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(16,185,129,0.35), rgba(16,185,129,0) 70%)",
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
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/30 bg-violet-500/15 backdrop-blur-md px-3 py-1 mb-6">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-300 opacity-80" />
              <span className="relative inline-flex size-1.5 rounded-full bg-violet-300" />
            </span>
            <span className="text-[10px] font-bold text-violet-100 uppercase tracking-[0.18em]">
              Etsy team access
            </span>
          </div>

          <div className="relative inline-flex mb-4">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-violet-400/40 to-emerald-500/40 blur-lg"
            />
            <div className="relative size-14 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-violet-900/40">
              <ShieldCheck className="size-7 text-white drop-shadow-lg" />
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.1]">
            Product Validator
          </h1>
          <p className="mt-3 text-[13px] sm:text-sm text-white/75 max-w-xl mx-auto leading-relaxed">
            A pre-listing policy check that flags Etsy violations
            <strong className="text-white font-semibold">
              {" "}before a product is listed
            </strong>
            , so the shop avoids removals and strikes.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 text-xs text-white/65">
            <Hourglass className="size-3.5" />
            <span>Built for the Etsy team · live for sellers today</span>
          </div>
        </div>
      </div>

      {/* Features */}
      <section>
        <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em] mb-3 px-1">
          What it does
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="border border-border/60 shadow-none">
                <CardContent className="p-5">
                  <div className="size-10 rounded-xl bg-gradient-to-br from-violet-500/15 to-emerald-500/15 ring-1 ring-violet-500/20 flex items-center justify-center mb-3">
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

      {/* Access note */}
      <Card className="border border-amber-300/40 dark:border-amber-700/30 bg-amber-50/50 dark:bg-amber-950/15 shadow-none">
        <CardContent className="p-5 flex items-start gap-3">
          <div className="size-9 rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center shrink-0">
            <Crown className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200 leading-tight">
              Etsy team access only
            </p>
            <p className="text-[12px] text-amber-800/85 dark:text-amber-200/80 mt-1 leading-relaxed">
              The Product Validator is restricted to sellers actively
              listing on Etsy (EM, AE, and ME teams, Izaan, and Etsy
              partners). Other roles do not have an Etsy shop to validate
              against.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
