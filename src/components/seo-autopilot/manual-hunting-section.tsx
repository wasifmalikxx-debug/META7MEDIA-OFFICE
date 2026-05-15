"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Heart,
  Users,
  Crown,
  Copy,
  Check,
  ExternalLink,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Package,
  Star,
  AlertTriangle,
  Wand2,
  Lightbulb,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Manual Hunting (May 16 2026 redesign).
 *
 * The new niche-centric flow:
 *   1. Employee types a niche ("boho jewelry")
 *   2. Optional style + audience pills (boho, minimalist, gift, anniversary)
 *   3. Backend: niche → 5-8 categories → 4-6 keywords per category →
 *      Etsy scoring + AliExpress preview for GREAT/GOOD
 *   4. Results render as an accordion of categories, each expandable
 *      to show its scored keywords
 *   5. Employee can add a custom category (re-runs hunt with that
 *      category forced in)
 *
 * Goal: one hunt = a category-organized listing roadmap.
 */

// ─── Types ──────────────────────────────────────────────────────────

type Verdict = "GREAT" | "GOOD" | "MAYBE" | "SKIP";

interface AliPreview {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceUsd: number;
  marginUsd: number;
  rating?: number;
  orderCount?: number;
}

interface NicheKeywordResult {
  keyword: string;
  totalListings: number;
  avgTopFavorites: number;
  uniqueShops: number;
  wordCount: number;
  score: number;
  verdict: Verdict;
  reasons: string[];
  topListings: Array<{
    title: string;
    favorites: number;
    listingId: number;
    url?: string;
  }>;
  aliPreview?: AliPreview[];
}

interface NicheCategoryResult {
  category: string;
  keywords: NicheKeywordResult[];
}

interface NicheHuntResponse {
  niche: string;
  style?: string;
  audience?: string;
  scanCount: number;
  totalCostUsd: number;
  durationMs: number;
  categories: NicheCategoryResult[];
}

// ─── Pill picker options ────────────────────────────────────────────

const STYLE_OPTIONS = [
  "Boho",
  "Minimalist",
  "Vintage",
  "Y2K",
  "Cottagecore",
  "Coastal",
  "Maximalist",
  "Modern",
];

const AUDIENCE_OPTIONS = [
  "Gift for Mom",
  "Anniversary",
  "Wedding",
  "Birthday",
  "Baby Shower",
  "Office",
  "Bridesmaids",
  "Self-gift",
];

const VERDICT_STYLE: Record<
  Verdict,
  { chip: string; tint: string; label: string; ringBorder: string }
> = {
  GREAT: {
    chip: "bg-emerald-500 text-white",
    tint: "from-emerald-500/10 via-transparent to-transparent",
    label: "Hunt this",
    ringBorder: "ring-emerald-500/30 border-emerald-500/40",
  },
  GOOD: {
    chip: "bg-sky-500 text-white",
    tint: "from-sky-500/10 via-transparent to-transparent",
    label: "Worth a look",
    ringBorder: "ring-sky-500/30 border-sky-500/40",
  },
  MAYBE: {
    chip: "bg-amber-500 text-white",
    tint: "from-amber-500/10 via-transparent to-transparent",
    label: "Maybe",
    ringBorder: "ring-amber-500/30 border-amber-500/40",
  },
  SKIP: {
    chip: "bg-rose-500 text-white",
    tint: "from-rose-500/5 via-transparent to-transparent",
    label: "Skip",
    ringBorder: "ring-rose-500/30 border-rose-500/40",
  },
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ─── Main section ───────────────────────────────────────────────────

export function ManualHuntingSection() {
  const [niche, setNiche] = useState("");
  const [style, setStyle] = useState<string | null>(null);
  const [audience, setAudience] = useState<string | null>(null);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);

  const [hunting, setHunting] = useState(false);
  const [result, setResult] = useState<NicheHuntResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hideWeaker, setHideWeaker] = useState(true);

  async function runHunt(extras: string[] = extraCategories) {
    if (niche.trim().length < 2 || hunting) return;
    setHunting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/seo-autopilot/hunt-by-niche", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim(),
          style,
          audience,
          extraCategories: extras.length ? extras : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as NicheHuntResponse;
      setResult(data);
      const wins = data.categories.reduce(
        (acc, c) =>
          acc +
          c.keywords.filter((k) => k.verdict === "GREAT" || k.verdict === "GOOD")
            .length,
        0,
      );
      toast.success(
        `${data.categories.length} categories · ${wins} hot keywords found`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Hunt failed";
      setErrorMsg(msg);
      toast.error("Hunt failed", { description: msg });
    } finally {
      setHunting(false);
    }
  }

  function handleReset() {
    setNiche("");
    setStyle(null);
    setAudience(null);
    setExtraCategories([]);
    setResult(null);
    setErrorMsg(null);
  }

  function addExtraCategory(category: string) {
    const trimmed = category.trim();
    if (!trimmed) return;
    const next = Array.from(new Set([...extraCategories, trimmed]));
    setExtraCategories(next);
    // Re-run the hunt with the new category — the backend keyword
    // expansion only fires for it (existing categories are cached in
    // the user's prior result, but for simplicity we re-run all).
    runHunt(next);
  }

  // Aggregate counts for the summary strip
  const summary = useMemo(() => {
    if (!result) return null;
    let great = 0,
      good = 0,
      maybe = 0,
      skip = 0,
      total = 0;
    for (const cat of result.categories) {
      for (const kw of cat.keywords) {
        total++;
        if (kw.verdict === "GREAT") great++;
        else if (kw.verdict === "GOOD") good++;
        else if (kw.verdict === "MAYBE") maybe++;
        else skip++;
      }
    }
    return { great, good, maybe, skip, total };
  }, [result]);

  return (
    <div className="space-y-5">
      {/* Input card — only shown when no result */}
      {!result && !hunting && (
        <NicheInputCard
          niche={niche}
          onNicheChange={setNiche}
          style={style}
          onStyleChange={setStyle}
          audience={audience}
          onAudienceChange={setAudience}
          disabled={hunting}
          onHunt={() => runHunt()}
        />
      )}

      {/* Loading state */}
      {hunting && <HuntProgress niche={niche} />}

      {/* Error */}
      {errorMsg && !hunting && (
        <Card className="border-rose-300/50 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 shadow-none">
          <CardContent className="p-5 flex items-start gap-3">
            <div className="size-9 rounded-xl bg-rose-500/20 ring-1 ring-rose-500/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-rose-900 dark:text-rose-200">
                Hunt failed
              </p>
              <p className="text-[12px] text-rose-700/90 dark:text-rose-300/80 mt-1 leading-relaxed">
                {errorMsg}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results — category accordion */}
      {result && !hunting && summary && (
        <>
          <ResultSummaryBar
            niche={result.niche}
            style={result.style}
            audience={result.audience}
            categoryCount={result.categories.length}
            summary={summary}
            hideWeaker={hideWeaker}
            onToggleWeaker={() => setHideWeaker((v) => !v)}
            onReset={handleReset}
            costUsd={result.totalCostUsd}
            durationMs={result.durationMs}
          />

          {result.categories.length === 0 ? (
            <Card className="border border-border/60">
              <CardContent className="p-10 text-center">
                <Target className="size-7 text-muted-foreground/60 mx-auto mb-2" />
                <p className="text-sm font-bold">No categories surfaced</p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Try a more concrete niche (e.g. &ldquo;boho jewelry&rdquo;
                  instead of &ldquo;jewelry&rdquo;).
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {result.categories.map((cat, idx) => (
                <CategoryCard
                  key={cat.category}
                  category={cat}
                  hideWeaker={hideWeaker}
                  defaultOpen={idx < 2}
                />
              ))}
              <AddCategoryButton
                disabled={hunting}
                onAdd={addExtraCategory}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Input card ─────────────────────────────────────────────────────

function NicheInputCard({
  niche,
  onNicheChange,
  style,
  onStyleChange,
  audience,
  onAudienceChange,
  disabled,
  onHunt,
}: {
  niche: string;
  onNicheChange: (v: string) => void;
  style: string | null;
  onStyleChange: (v: string | null) => void;
  audience: string | null;
  onAudienceChange: (v: string | null) => void;
  disabled: boolean;
  onHunt: () => void;
}) {
  const valid = niche.trim().length >= 2;
  return (
    <Card
      className="border border-border/60 bg-card/95 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_12px_36px_-12px_rgba(0,0,0,0.5)] ap-stagger-in"
    >
      <CardContent className="p-7 sm:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3.5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-sky-400/30 to-violet-500/30 blur-md"
            />
            <div className="relative size-11 rounded-2xl bg-gradient-to-br from-sky-500 to-violet-600 ring-1 ring-violet-700/30 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Search className="size-5 text-white" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-[0.22em]">
              Step one
            </p>
            <h3 className="text-[17px] font-bold tracking-tight leading-tight mt-0.5">
              What niche are you hunting?
            </h3>
            <p className="text-[12px] text-muted-foreground/80 mt-0.5">
              A niche or product category — we&apos;ll discover the right
              sub-categories and keywords for you.
            </p>
          </div>
        </div>

        {/* Niche input */}
        <div className="space-y-2">
          <Input
            type="text"
            value={niche}
            onChange={(e) => onNicheChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !disabled) onHunt();
            }}
            placeholder="e.g. boho jewelry · home decor · pet supplies · phone accessories"
            disabled={disabled}
            className="h-12 text-sm bg-muted/20 border-border/70 focus-visible:border-sky-500/60 focus-visible:ring-sky-500/15 placeholder:text-muted-foreground/55"
          />
          <p className="text-[11px] text-muted-foreground/70 leading-snug">
            Tip: be broad enough to span multiple sub-categories. &ldquo;Boho
            jewelry&rdquo; works; &ldquo;earrings&rdquo; alone is too narrow.
          </p>
        </div>

        {/* Style pills (optional) */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Style <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STYLE_OPTIONS.map((opt) => (
              <OptionPill
                key={opt}
                label={opt}
                selected={style === opt}
                onClick={() => onStyleChange(style === opt ? null : opt)}
                accent="violet"
                disabled={disabled}
              />
            ))}
          </div>
        </div>

        {/* Audience pills (optional) */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Audience <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {AUDIENCE_OPTIONS.map((opt) => (
              <OptionPill
                key={opt}
                label={opt}
                selected={audience === opt}
                onClick={() => onAudienceChange(audience === opt ? null : opt)}
                accent="sky"
                disabled={disabled}
              />
            ))}
          </div>
        </div>

        {/* Hunt button */}
        <div className="relative group">
          <div
            aria-hidden
            className={`absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-sky-500 via-violet-500 to-pink-600 blur-md transition-opacity ${
              valid ? "opacity-50 group-hover:opacity-75" : "opacity-0"
            }`}
          />
          <Button
            type="button"
            onClick={onHunt}
            disabled={!valid || disabled}
            className="relative w-full h-14 gap-3 bg-gradient-to-r from-sky-500 via-violet-500 to-violet-600 hover:from-sky-500 hover:via-violet-500 hover:to-violet-600 text-white font-bold text-[15px] tracking-wide rounded-2xl shadow-xl shadow-violet-500/30 ring-1 ring-violet-700/30 hover:shadow-2xl hover:shadow-violet-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <Wand2 className="size-5" />
            <span>Hunt by niche</span>
            <span className="ml-1 text-xs font-semibold opacity-80 hidden sm:inline">
              · ~20s
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OptionPill({
  label,
  selected,
  onClick,
  accent,
  disabled,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  accent: "violet" | "sky";
  disabled: boolean;
}) {
  const accentClasses =
    accent === "violet"
      ? "bg-gradient-to-r from-violet-500 to-pink-500 text-white ring-violet-500/40 shadow-sm shadow-violet-500/20"
      : "bg-gradient-to-r from-sky-500 to-emerald-500 text-white ring-sky-500/40 shadow-sm shadow-sky-500/20";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-bold tracking-wide ring-1 transition-all disabled:opacity-50 ${
        selected
          ? accentClasses
          : "bg-muted/30 ring-border/60 text-foreground/85 hover:bg-muted/50 hover:ring-border"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Hunt progress ──────────────────────────────────────────────────

function HuntProgress({ niche }: { niche: string }) {
  return (
    <Card className="border border-border/60 ap-stagger-in overflow-hidden relative">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-sky-50/50 via-transparent to-violet-50/40 dark:from-sky-950/15 dark:via-transparent dark:to-violet-950/15"
      />
      <CardContent className="relative p-8 sm:p-10">
        <div className="flex flex-col items-center text-center">
          <div className="relative size-28 mb-5">
            <div
              aria-hidden
              className="absolute -inset-6 rounded-full bg-gradient-to-br from-sky-400/30 to-violet-500/30 blur-2xl ap-orb-pulse"
            />
            <div
              aria-hidden
              className="absolute inset-0 rounded-full ring-2 ring-sky-400/30 ap-orb-spin"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 size-3 rounded-full bg-sky-500 shadow-lg shadow-sky-500/60" />
            </div>
            <div
              aria-hidden
              className="absolute inset-3 rounded-full ring-2 ring-violet-400/30 ap-orb-spin"
              style={{ animationDirection: "reverse", animationDuration: "11s" }}
            >
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 size-2.5 rounded-full bg-violet-500 shadow-lg shadow-violet-500/60" />
            </div>
            <div className="absolute inset-6 rounded-full bg-gradient-to-br from-sky-500 to-violet-600 ring-1 ring-white/30 flex items-center justify-center shadow-2xl shadow-violet-500/40">
              <Target className="size-7 text-white" />
            </div>
          </div>

          <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-[0.22em] mb-1">
            Hunting niche
          </p>
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight">
            &ldquo;{niche}&rdquo;
          </h3>
          <p className="text-[13px] text-muted-foreground mt-1.5 max-w-md">
            Discovering categories · brainstorming keywords · checking Etsy
            demand · pulling AliExpress matches. Usually 20-30 seconds.
          </p>

          <div className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80 tabular-nums">
            <Loader2 className="size-3 animate-spin" />
            <span>Working across both APIs</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Result summary bar ─────────────────────────────────────────────

function ResultSummaryBar({
  niche,
  style,
  audience,
  categoryCount,
  summary,
  hideWeaker,
  onToggleWeaker,
  onReset,
  costUsd,
  durationMs,
}: {
  niche: string;
  style?: string;
  audience?: string;
  categoryCount: number;
  summary: { great: number; good: number; maybe: number; skip: number; total: number };
  hideWeaker: boolean;
  onToggleWeaker: () => void;
  onReset: () => void;
  costUsd: number;
  durationMs: number;
}) {
  return (
    <Card className="border border-border/60 shadow-none ap-stagger-in">
      <CardContent className="p-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Niche hunt
            </p>
            <h2 className="text-lg font-bold tracking-tight mt-0.5 leading-tight">
              {niche}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {style && (
                <span className="inline-flex items-center text-[10px] font-bold tracking-wide bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30 px-2 py-0.5 rounded-full">
                  {style}
                </span>
              )}
              {audience && (
                <span className="inline-flex items-center text-[10px] font-bold tracking-wide bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30 px-2 py-0.5 rounded-full">
                  {audience}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {categoryCount} categories · {summary.total} keywords
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <SummaryCount count={summary.great} label="GREAT" tint="emerald" />
            <SummaryCount count={summary.good} label="GOOD" tint="sky" />
            <SummaryCount count={summary.maybe} label="MAYBE" tint="amber" muted />
            <SummaryCount count={summary.skip} label="SKIP" tint="rose" muted />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-border/40 flex-wrap">
          <button
            type="button"
            onClick={onToggleWeaker}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
          >
            {hideWeaker ? "Show" : "Hide"} MAYBE / SKIP
          </button>

          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              ${costUsd.toFixed(4)} · {(durationMs / 1000).toFixed(1)}s
            </span>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-foreground/5 hover:bg-foreground/10 transition-colors"
            >
              <Wand2 className="size-2.5" />
              Hunt another
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCount({
  count,
  label,
  tint,
  muted,
}: {
  count: number;
  label: string;
  tint: "emerald" | "sky" | "amber" | "rose";
  muted?: boolean;
}) {
  const colorClasses = {
    emerald: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 ring-emerald-500/30",
    sky: "text-sky-700 dark:text-sky-300 bg-sky-500/15 ring-sky-500/30",
    amber: "text-amber-700 dark:text-amber-300 bg-amber-500/15 ring-amber-500/30",
    rose: "text-rose-700 dark:text-rose-300 bg-rose-500/15 ring-rose-500/30",
  }[tint];
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ring-1 ${colorClasses} ${
        muted ? "opacity-60" : ""
      }`}
    >
      <span className="text-[14px] font-bold tabular-nums leading-none">
        {count}
      </span>
      <span className="text-[9px] font-bold uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

// ─── Category card ──────────────────────────────────────────────────

function CategoryCard({
  category,
  hideWeaker,
  defaultOpen,
}: {
  category: NicheCategoryResult;
  hideWeaker: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const visible = category.keywords.filter((k) =>
    hideWeaker ? k.verdict === "GREAT" || k.verdict === "GOOD" : true,
  );
  const hiddenCount = category.keywords.length - visible.length;

  const wins = category.keywords.filter(
    (k) => k.verdict === "GREAT" || k.verdict === "GOOD",
  ).length;

  return (
    <Card className="border border-border/60 shadow-none overflow-hidden ap-stagger-in">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
      >
        <CardContent className="p-4 flex items-center gap-3 hover:bg-muted/30 transition-colors">
          <div className="size-9 rounded-lg bg-gradient-to-br from-sky-500/20 to-violet-500/20 ring-1 ring-violet-500/30 flex items-center justify-center shrink-0">
            <Lightbulb className="size-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold tracking-tight">
              {category.category}
            </p>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {category.keywords.length} keywords · {wins} hot
              {hiddenCount > 0 && hideWeaker && (
                <span className="text-muted-foreground/60">
                  {" "}
                  · {hiddenCount} hidden
                </span>
              )}
            </p>
          </div>
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </CardContent>
      </button>

      {open && visible.length > 0 && (
        <div className="border-t border-border/40 p-4 space-y-2">
          {visible.map((kw, i) => (
            <KeywordCard key={kw.keyword} keyword={kw} rank={i + 1} />
          ))}
        </div>
      )}
      {open && visible.length === 0 && (
        <div className="border-t border-border/40 px-4 py-6 text-center">
          <p className="text-[12px] text-muted-foreground italic">
            All keywords in this category scored MAYBE or SKIP. Click
            &ldquo;Show MAYBE / SKIP&rdquo; above to view them.
          </p>
        </div>
      )}
    </Card>
  );
}

// ─── Keyword card ───────────────────────────────────────────────────

function KeywordCard({
  keyword,
  rank,
}: {
  keyword: NicheKeywordResult;
  rank: number;
}) {
  const style = VERDICT_STYLE[keyword.verdict];
  const [copied, setCopied] = useState(false);

  // Lazy-loaded AE preview for MAYBE/SKIP rows (or any row without
  // auto-loaded aliPreview). Click "Find on AliExpress" → POST to
  // /api/aliexpress/products-for-keyword → render inline below.
  const [lazyPreview, setLazyPreview] = useState<AliPreview[] | null>(null);
  const [lazyOpen, setLazyOpen] = useState(false);
  const [lazyLoading, setLazyLoading] = useState(false);
  const [lazyError, setLazyError] = useState<string | null>(null);

  async function handleCopy() {
    await navigator.clipboard.writeText(keyword.keyword);
    setCopied(true);
    toast.success(`Copied "${keyword.keyword}"`);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleFindOnAliExpress() {
    // If auto-preview already exists, just open/scroll to it
    if (keyword.aliPreview && keyword.aliPreview.length > 0) {
      setLazyOpen((v) => !v);
      return;
    }
    // Otherwise lazy-fetch
    if (lazyLoading) return;
    if (lazyPreview) {
      setLazyOpen((v) => !v);
      return;
    }
    setLazyLoading(true);
    setLazyError(null);
    setLazyOpen(true);
    try {
      const res = await fetch("/api/aliexpress/products-for-keyword", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.keyword, limit: 10 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error(
            "AliExpress not connected — use the Connect button above.",
          );
        }
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as {
        products: Array<{
          productId: number;
          title: string;
          imageUrl?: string;
          productUrl?: string;
          priceMin: number;
          rating?: number;
          orderCount?: number;
        }>;
      };
      // Convert to AliPreview shape (we don't have margin from this
      // endpoint, so leave it 0 — keyword-level click is just "show me
      // matching products," not the full margin breakdown).
      const previews: AliPreview[] = data.products.slice(0, 10).map((p) => ({
        productId: p.productId,
        title: p.title,
        imageUrl: p.imageUrl,
        productUrl: p.productUrl,
        priceUsd: p.priceMin,
        marginUsd: 0,
        rating: p.rating,
        orderCount: p.orderCount,
      }));
      setLazyPreview(previews);
      if (previews.length === 0) {
        toast.message("No AliExpress matches for this keyword");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setLazyError(msg);
      toast.error("AliExpress lookup failed", { description: msg });
    } finally {
      setLazyLoading(false);
    }
  }

  const aliExpressUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword.keyword)}`;
  const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(keyword.keyword)}`;

  const hasAutoPreview = !!keyword.aliPreview && keyword.aliPreview.length > 0;
  const showLazyPreview = lazyOpen && !hasAutoPreview;

  return (
    <div
      className={`relative rounded-xl ring-1 ${style.ringBorder} overflow-hidden`}
    >
      <div
        aria-hidden
        className={`absolute inset-0 bg-gradient-to-r ${style.tint} pointer-events-none`}
      />
      <div className="relative p-4">
        <div className="flex items-start gap-3">
          {/* Rank chip */}
          <div
            className={`size-9 rounded-lg ring-1 flex items-center justify-center shrink-0 shadow-sm ${style.chip}`}
          >
            {rank === 1 ? (
              <Crown className="size-4" />
            ) : (
              <span className="text-[11px] font-bold tabular-nums">#{rank}</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {/* Verdict + score */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] ring-1 ${style.chip} ${style.ringBorder}`}
              >
                {keyword.verdict}
              </span>
              <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
                {keyword.score}/100
              </span>
            </div>

            <h4 className="text-[14px] font-bold leading-tight mt-1 tracking-tight">
              {keyword.keyword}
            </h4>

            {/* Compact stats */}
            <div className="mt-2 flex flex-wrap gap-2.5 text-[10px] text-muted-foreground tabular-nums">
              <span className="inline-flex items-center gap-1">
                <TrendingUp className="size-2.5" />
                {formatCount(keyword.totalListings)} listings
              </span>
              <span className="inline-flex items-center gap-1">
                <Heart className="size-2.5" />
                {formatCount(keyword.avgTopFavorites)} avg favs
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-2.5" />
                {keyword.uniqueShops} shops
              </span>
            </div>

            {/* Reasons */}
            {keyword.reasons.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {keyword.reasons.slice(0, 2).map((r, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-muted-foreground leading-snug flex items-start gap-1.5"
                  >
                    <span className="mt-1 size-1 rounded-full bg-muted-foreground/50 shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Action buttons — same 4 buttons on every keyword row so the
                team has consistent muscle memory. "Find on AliExpress" lazy-
                loads inline products for MAYBE/SKIP rows; for GREAT/GOOD it
                toggles the auto-loaded preview. */}
            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[9px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
              >
                {copied ? (
                  <Check className="size-2.5 text-emerald-500" strokeWidth={3} />
                ) : (
                  <Copy className="size-2.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={aliExpressUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow shadow-orange-500/30 hover:opacity-90 transition-opacity"
              >
                <ExternalLink className="size-2.5" />
                Hunt on AliExpress
              </a>
              <a
                href={etsyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[9px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
              >
                <ExternalLink className="size-2.5" />
                See on Etsy
              </a>
              <button
                type="button"
                onClick={handleFindOnAliExpress}
                disabled={lazyLoading}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-violet-500 to-pink-500 text-white shadow shadow-violet-500/30 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {lazyLoading ? (
                  <Loader2 className="size-2.5 animate-spin" />
                ) : (
                  <Search className="size-2.5" />
                )}
                Find on AliExpress
              </button>
            </div>

            {/* Inline AE preview — auto-loaded for GREAT/GOOD */}
            {hasAutoPreview && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  AliExpress matches · top by orders
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {keyword.aliPreview!.map((p) => (
                    <MiniAliCard key={p.productId} product={p} />
                  ))}
                </div>
              </div>
            )}

            {/* Lazy-loaded preview — for MAYBE/SKIP when user clicks Find on AliExpress */}
            {showLazyPreview && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  AliExpress matches
                </p>
                {lazyLoading && (
                  <p className="text-[11px] text-muted-foreground italic">
                    Searching AliExpress…
                  </p>
                )}
                {lazyError && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50/40 dark:bg-rose-950/20 ring-1 ring-rose-500/20 rounded-md px-3 py-2">
                    {lazyError}
                  </p>
                )}
                {lazyPreview && lazyPreview.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {lazyPreview.map((p) => (
                      <MiniAliCard key={p.productId} product={p} hideMargin />
                    ))}
                  </div>
                )}
                {lazyPreview && lazyPreview.length === 0 && !lazyError && (
                  <p className="text-[11px] text-muted-foreground italic">
                    No matching AliExpress products. Try the &ldquo;Hunt on
                    AliExpress&rdquo; link above for broader results.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniAliCard({
  product,
  hideMargin,
}: {
  product: AliPreview;
  hideMargin?: boolean;
}) {
  return (
    <a
      href={product.productUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-2 rounded-lg ring-1 ring-border/50 bg-card hover:bg-muted/30 transition-colors p-2"
    >
      <div className="size-14 rounded-md bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <Package className="size-4 text-muted-foreground/40" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] leading-tight line-clamp-2">
          {product.title}
        </p>
        <p className="text-[11px] font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
          ${product.priceUsd.toFixed(2)}
        </p>
        <p className="text-[9px] tabular-nums text-muted-foreground leading-none mt-0.5">
          {!hideMargin && <>+${product.marginUsd.toFixed(2)} margin</>}
          {!hideMargin && product.rating !== undefined && " · "}
          {product.rating !== undefined && (
            <>
              <Star
                className="inline size-2 text-amber-500 -translate-y-px"
                fill="currentColor"
                strokeWidth={0}
              />
              {product.rating.toFixed(1)}
            </>
          )}
          {product.orderCount !== undefined &&
            product.orderCount > 0 && (
              <>
                {(product.rating !== undefined || !hideMargin) && " · "}
                {product.orderCount.toLocaleString()} orders
              </>
            )}
        </p>
      </div>
    </a>
  );
}

// ─── Add custom category button ─────────────────────────────────────

function AddCategoryButton({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (category: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  function commit() {
    if (value.trim().length >= 2) {
      onAdd(value.trim());
      setValue("");
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="w-full h-14 rounded-xl border border-dashed border-border/70 hover:border-border hover:bg-muted/30 transition-colors flex items-center justify-center gap-2 text-[12px] font-bold tracking-wide text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Plus className="size-4" />
        Add a category the AI missed
      </button>
    );
  }

  return (
    <Card className="border border-sky-500/40 shadow-none">
      <CardContent className="p-3 flex items-center gap-2">
        <Sparkles className="size-4 text-sky-500 shrink-0" />
        <Input
          type="text"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setEditing(false);
              setValue("");
            }
          }}
          placeholder="Category name (e.g. Hair Accessories)"
          className="h-9 flex-1 bg-transparent border-0 focus-visible:ring-0 text-sm"
          maxLength={40}
        />
        <Button
          type="button"
          onClick={commit}
          disabled={value.trim().length < 2 || disabled}
          className="h-9 bg-sky-500 hover:bg-sky-600 text-white text-[11px] font-bold"
        >
          Add & hunt
        </Button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue("");
          }}
          className="size-8 rounded-md hover:bg-muted/60 flex items-center justify-center text-muted-foreground"
          aria-label="Cancel"
        >
          <X className="size-4" />
        </button>
      </CardContent>
    </Card>
  );
}
