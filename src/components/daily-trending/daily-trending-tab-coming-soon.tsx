"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Flame, Bookmark, Sparkles, TrendingUp, Crown } from "lucide-react";

/**
 * Compact in-tab Coming Soon — used by ProductHunterView when a
 * non-CEO user opens the "Trending" tab. No own hero (Product Hunter
 * already has one), just the feature grid + access note.
 *
 * Separate from the full-page DailyTrendingComingSoon (which has its
 * own hero) so we don't double-stack heroes inside the hub.
 */
export function DailyTrendingTabComingSoon() {
  const features = [
    {
      icon: Bookmark,
      title: "Per-seller niche book",
      copy: "Each Etsy seller picks up to 5 niches they work — boho jewelry, cottagecore decor, anything.",
    },
    {
      icon: Flame,
      title: "Fresh batch at 5 AM PKT",
      copy: "Cron pulls the hottest AliExpress products in each niche every morning before the workday starts.",
    },
    {
      icon: Sparkles,
      title: "One-click sourcing",
      copy: "Open AE direct, pre-fill the calculator, or jump into Manual Hunting — all from one card.",
    },
    {
      icon: TrendingUp,
      title: "Claim before others",
      copy: "Lock a product to your shop so the rest of the team knows it's yours and moves on.",
    },
  ];

  return (
    <div className="space-y-4 ap-stagger-in">
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-11 rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 ring-1 ring-orange-500/40 flex items-center justify-center shadow shadow-orange-500/30">
              <Flame className="size-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-600 dark:text-orange-400">
                Coming Soon · For the team
              </p>
              <h3 className="text-[17px] font-bold leading-tight">
                Morning AE feed scoped to your niches
              </h3>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-xl ring-1 ring-border/50 bg-card p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="size-9 rounded-lg ring-1 bg-orange-500/10 ring-orange-500/30 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold tracking-tight">
                        {f.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                        {f.copy}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
              Wasif is validating the daily picks himself before turning the
              team loose on a fully-automated feed. Once the signal is
              proven, the niche book opens up to every Etsy seller.
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground italic">
        You&apos;ll be notified the moment Daily Trending goes live for the team.
      </p>
    </div>
  );
}
