"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Wand2,
  Hourglass,
  ImagePlus,
  UserCheck,
  Sparkles,
  Repeat2,
} from "lucide-react";

/**
 * Pre-launch placeholder for Prompt Engineer.
 *
 * Shown to everyone except the CEO. The real tool stays CEO-only while
 * Wasif validates the prompt quality before rolling it out to the team.
 */
export function PromptEngineerComingSoon() {
  const features = [
    {
      icon: ImagePlus,
      title: "Upload a product photo",
      copy: "Drop an AliExpress photo — the assistant reads the exact product (fabric, color, cut, details).",
    },
    {
      icon: UserCheck,
      title: "USA model, new pose",
      copy: "Same product, swapped onto a fresh Western model in a different, flattering pose.",
    },
    {
      icon: Repeat2,
      title: "Consistent across the listing",
      copy: "Locks one model for all 7-8 images so the same person appears in every shot.",
    },
    {
      icon: Sparkles,
      title: "Ready for Higgsfield",
      copy: "Get a copy-paste image-generation prompt with background, style, and ratio dialed in.",
    },
  ];

  return (
    <div className="relative max-w-4xl mx-auto space-y-6 pb-12">
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-violet-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1a2a] via-[#1a1226] to-[#0d1a2a]" />
        <div
          aria-hidden
          className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(139,92,246,0.35), rgba(139,92,246,0) 70%)",
          }}
        />
        <div className="relative px-6 py-12 sm:px-12 sm:py-16 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-inset ring-white/15">
            <Hourglass className="size-3" /> Coming Soon
          </span>
          <div className="mt-6 flex justify-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/40">
              <Wand2 className="size-8 text-white" />
            </div>
          </div>
          <h1 className="mt-5 text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Prompt Engineer
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/70">
            Turn any AliExpress product photo into a Higgsfield image-generation
            prompt — same product, fresh USA model, new pose, and a consistent
            model across every image in your listing. Rolling out to the team
            soon.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {features.map((f) => (
          <Card key={f.title} className="border-0 shadow-sm">
            <CardContent className="px-5 py-4 flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950/40 ring-1 ring-inset ring-violet-200 dark:ring-violet-900/50">
                <f.icon className="size-4 text-violet-600 dark:text-violet-400" />
              </span>
              <div>
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {f.copy}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
