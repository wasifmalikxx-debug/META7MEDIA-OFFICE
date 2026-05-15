"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Sparkles,
  Target,
  ExternalLink,
  Plus,
  X,
  Package,
  AlertTriangle,
  Wand2,
  Search,
  ShoppingBag,
  TrendingUp,
  Heart,
  Users,
  Star,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Manual Hunting v2.2 — May 16 2026 redesign (third revision).
 *
 * Layout: category tabs at top (horizontally scrollable), inside the
 * active category we show keyword cards. Each keyword card has:
 *   - Keyword + verdict pill + score
 *   - Etsy stats strip
 *   - "Hunt on AliExpress" + "See on Etsy" quick-search buttons
 *   - Product grid (top 5 quality-filtered AE products)
 *
 * No more accordions. One tab visible at a time. Cleaner mental model.
 */

// ─── Types ──────────────────────────────────────────────────────────

interface KeywordPreview {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceUsd: number;
  rating?: number;
  orderCount?: number;
}

type Verdict = "GREAT" | "GOOD" | "MAYBE" | "SKIP";

interface NicheKeywordResult {
  keyword: string;
  totalListings: number;
  avgTopFavorites: number;
  uniqueShops: number;
  score: number;
  verdict: Verdict;
  /** Slim representative product preview (1 per keyword). Optional. */
  preview?: KeywordPreview;
}

interface NicheCategoryResult {
  category: string;
  keywords: NicheKeywordResult[];
  totalProducts: number;
  etsyHotKeywords: number;
  etsyTotalListings: number;
}

interface NicheHuntResponse {
  niche: string;
  style?: string;
  audience?: string;
  scanCount: number;
  productCount: number;
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
  { chip: string; ringBorder: string; label: string }
> = {
  GREAT: {
    chip: "bg-emerald-500 text-white",
    ringBorder: "ring-emerald-500/30",
    label: "GREAT",
  },
  GOOD: {
    chip: "bg-sky-500 text-white",
    ringBorder: "ring-sky-500/30",
    label: "GOOD",
  },
  MAYBE: {
    chip: "bg-amber-500 text-white",
    ringBorder: "ring-amber-500/30",
    label: "MAYBE",
  },
  SKIP: {
    chip: "bg-rose-500 text-white",
    ringBorder: "ring-rose-500/30",
    label: "SKIP",
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
  const [activeCategoryIdx, setActiveCategoryIdx] = useState(0);

  // Reset active category when a new result lands
  useEffect(() => {
    if (result) setActiveCategoryIdx(0);
  }, [result]);

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
      toast.success(
        `${data.categories.length} categories · ${data.productCount} vetted products`,
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
    runHunt(next);
  }

  return (
    <div className="space-y-5">
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

      {hunting && <HuntProgress niche={niche} />}

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

      {result && !hunting && (
        <>
          <ResultHero
            niche={result.niche}
            style={result.style}
            audience={result.audience}
            categoryCount={result.categories.length}
            productCount={result.productCount}
            onReset={handleReset}
            costUsd={result.totalCostUsd}
            durationMs={result.durationMs}
          />

          {result.categories.length === 0 ? (
            <EmptyResultCard niche={result.niche} />
          ) : (
            <>
              <CategoryTabBar
                categories={result.categories}
                activeIdx={activeCategoryIdx}
                onSelect={setActiveCategoryIdx}
              />
              <CategoryPanel
                category={result.categories[activeCategoryIdx]}
              />
              <AddCategoryButton
                disabled={hunting}
                onAdd={addExtraCategory}
              />
            </>
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
    <Card className="border border-border/60 bg-card/95 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_12px_36px_-12px_rgba(0,0,0,0.5)] ap-stagger-in">
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
              Start here
            </p>
            <h3 className="text-[18px] font-bold tracking-tight leading-tight mt-0.5">
              What&apos;s your shop&apos;s niche?
            </h3>
            <p className="text-[12px] text-muted-foreground/80 mt-1 leading-relaxed">
              We&apos;ll find the proven-selling categories, the keywords
              that buyers actually search, and curated AliExpress products
              for each one.
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
            placeholder="e.g. boho jewelry · home decor · pet supplies · kitchen organizer"
            disabled={disabled}
            className="h-14 text-base bg-muted/20 border-border/70 focus-visible:border-sky-500/60 focus-visible:ring-sky-500/15 placeholder:text-muted-foreground/55"
          />
          <p className="text-[11px] text-muted-foreground/70 leading-snug px-0.5">
            Tip: a niche works best when it spans multiple shop sections.
            &ldquo;Boho jewelry&rdquo; works; &ldquo;earrings&rdquo; alone
            is too narrow.
          </p>
        </div>

        {/* Style + audience pills, always open */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Style{" "}
            <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">
              (optional)
            </span>
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

        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Audience{" "}
            <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">
              (optional)
            </span>
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
            <span>Find products for my niche</span>
            <span className="ml-1 text-xs font-semibold opacity-80 hidden sm:inline">
              · ~30s
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
      <CardContent className="relative p-10 sm:p-12">
        <div className="flex flex-col items-center text-center">
          <div className="relative size-32 mb-6">
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
            <div className="absolute inset-7 rounded-full bg-gradient-to-br from-sky-500 to-violet-600 ring-1 ring-white/30 flex items-center justify-center shadow-2xl shadow-violet-500/40">
              <ShoppingBag className="size-8 text-white" />
            </div>
          </div>

          <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-[0.22em] mb-1">
            Curating products
          </p>
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight">
            &ldquo;{niche}&rdquo;
          </h3>
          <p className="text-[13px] text-muted-foreground mt-2 max-w-md leading-relaxed">
            Discovering proven categories · brainstorming buyer keywords ·
            checking Etsy demand · pulling AliExpress products ·
            quality-filtering.
          </p>

          <div className="mt-6 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80 tabular-nums">
            <Loader2 className="size-3 animate-spin" />
            <span>Usually 25-35 seconds</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Result hero ────────────────────────────────────────────────────

function ResultHero({
  niche,
  style,
  audience,
  categoryCount,
  productCount,
  onReset,
  costUsd,
  durationMs,
}: {
  niche: string;
  style?: string;
  audience?: string;
  categoryCount: number;
  productCount: number;
  onReset: () => void;
  costUsd: number;
  durationMs: number;
}) {
  return (
    <Card className="border border-border/60 shadow-none ap-stagger-in overflow-hidden relative">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.04] via-transparent to-violet-500/[0.04]"
      />
      <CardContent className="relative p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Niche hunt complete
            </p>
            <h2 className="text-2xl font-bold tracking-tight mt-0.5 leading-tight">
              {niche}
            </h2>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold">
                <Target className="size-3.5 text-violet-500" />
                <span className="tabular-nums">{categoryCount}</span>
                <span className="text-muted-foreground font-normal">
                  categories
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold">
                <Package className="size-3.5 text-emerald-500" />
                <span className="tabular-nums">{productCount}</span>
                <span className="text-muted-foreground font-normal">
                  scored keywords
                </span>
              </span>
              {style && (
                <span className="inline-flex items-center text-[10px] font-bold bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30 px-2 py-0.5 rounded-full">
                  {style}
                </span>
              )}
              {audience && (
                <span className="inline-flex items-center text-[10px] font-bold bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30 px-2 py-0.5 rounded-full">
                  {audience}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-foreground/5 hover:bg-foreground/10 transition-colors"
          >
            <Wand2 className="size-3" />
            Hunt another niche
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground/70 tabular-nums mt-3 pt-3 border-t border-border/40">
          Cost: ${costUsd.toFixed(4)} · {(durationMs / 1000).toFixed(1)}s
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyResultCard({ niche }: { niche: string }) {
  return (
    <Card className="border border-border/60">
      <CardContent className="p-10 text-center">
        <Target className="size-7 text-muted-foreground/60 mx-auto mb-2" />
        <p className="text-sm font-bold">No vetted products found</p>
        <p className="text-[12px] text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
          We couldn&apos;t surface high-quality products for &ldquo;{niche}
          &rdquo;. Try a more specific niche, or check that AliExpress is
          connected at the top of this page.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Category tab bar ──────────────────────────────────────────────

function CategoryTabBar({
  categories,
  activeIdx,
  onSelect,
}: {
  categories: NicheCategoryResult[];
  activeIdx: number;
  onSelect: (idx: number) => void;
}) {
  return (
    <div className="relative ap-stagger-in">
      <div className="flex gap-1.5 overflow-x-auto pb-1.5 -mx-1 px-1 snap-x scrollbar-thin">
        {categories.map((cat, idx) => {
          const active = idx === activeIdx;
          return (
            <button
              key={cat.category}
              type="button"
              onClick={() => onSelect(idx)}
              className={`relative flex-shrink-0 snap-start rounded-xl ring-1 transition-all overflow-hidden ${
                active
                  ? "ring-foreground/30 bg-card shadow-md"
                  : "ring-border/50 bg-card/60 hover:ring-border hover:bg-card"
              }`}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-br from-sky-500/[0.08] to-violet-500/[0.08]"
                />
              )}
              <div className="relative flex items-center gap-2.5 px-3.5 py-2.5">
                <span
                  className={`text-[12px] font-bold tracking-tight ${active ? "text-foreground" : "text-foreground/80"}`}
                >
                  {cat.category}
                </span>
                <span
                  className={`inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded-md text-[10px] font-bold tabular-nums ring-1 ${
                    active
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30"
                      : "bg-muted/40 text-muted-foreground ring-border/40"
                  }`}
                >
                  {cat.totalProducts}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Category panel (renders keywords + their products) ────────────

function CategoryPanel({ category }: { category: NicheCategoryResult }) {
  return (
    <div className="space-y-3 ap-stagger-in">
      {/* Category header strip */}
      <div className="flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold tracking-tight leading-tight">
            {category.category}
          </h3>
          <p className="text-[12px] text-muted-foreground tabular-nums mt-0.5">
            {category.keywords.length} keyword{category.keywords.length === 1 ? "" : "s"} ·{" "}
            {category.totalProducts} product{category.totalProducts === 1 ? "" : "s"}
            {category.etsyHotKeywords > 0 && (
              <span className="text-emerald-700 dark:text-emerald-400">
                {" · "}
                {category.etsyHotKeywords} hot
              </span>
            )}
            {category.etsyTotalListings > 0 && (
              <span>
                {" · "}
                {formatCount(category.etsyTotalListings)} Etsy listings
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Keyword cards */}
      {category.keywords.map((kw) => (
        <KeywordCard key={kw.keyword} keyword={kw} />
      ))}
    </div>
  );
}

// ─── Keyword card (header + 5-product grid) ────────────────────────

function KeywordCard({ keyword }: { keyword: NicheKeywordResult }) {
  const verdictStyle = VERDICT_STYLE[keyword.verdict];

  const aliExpressUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword.keyword)}`;
  const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(keyword.keyword)}`;

  return (
    <Card className="border border-border/60 shadow-none overflow-hidden ap-stagger-in">
      {/* Header */}
      <div className="p-4 sm:p-5 flex items-center gap-3 flex-wrap">
        {/* Verdict badge */}
        <span
          className={`inline-flex items-center rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] ${verdictStyle.chip} ring-1 ${verdictStyle.ringBorder}`}
        >
          {verdictStyle.label}
        </span>

        {/* Score */}
        <span className="inline-flex items-center text-[11px] font-bold tabular-nums text-muted-foreground bg-muted/40 ring-1 ring-border/40 px-1.5 py-0.5 rounded-md">
          {keyword.score}/100
        </span>

        {/* Keyword */}
        <h4 className="text-[15px] sm:text-base font-bold tracking-tight leading-tight flex-1 min-w-0 truncate">
          {keyword.keyword}
        </h4>

        {/* Quick search buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={aliExpressUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow shadow-orange-500/30 hover:opacity-90 transition-opacity"
            title={`Search "${keyword.keyword}" on AliExpress`}
          >
            <ExternalLink className="size-2.5" />
            Hunt on AliExpress
          </a>
          <a
            href={etsyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
            title={`Search "${keyword.keyword}" on Etsy`}
          >
            <Search className="size-2.5" />
            See on Etsy
          </a>
        </div>
      </div>

      {/* Stats strip */}
      <div className="px-4 sm:px-5 pb-3 flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums border-b border-border/40">
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

      {/* Preview strip — ONE strictly-matched AE product so the user
          immediately sees what kind of product this keyword represents.
          Only renders when we found a real match (strict relevance
          filter passed). */}
      {keyword.preview && <PreviewStrip preview={keyword.preview} />}
    </Card>
  );
}

function PreviewStrip({ preview }: { preview: KeywordPreview }) {
  const href =
    preview.productUrl ??
    "#";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 p-3 sm:p-4 hover:bg-muted/30 transition-colors"
    >
      {/* Product image */}
      <div className="size-14 sm:size-16 rounded-lg bg-muted/40 overflow-hidden shrink-0 ring-1 ring-border/40">
        {preview.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.imageUrl}
            alt=""
            className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="size-full flex items-center justify-center">
            <Package className="size-5 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Title + tag + stats */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-orange-600 dark:text-orange-400 bg-orange-500/10 ring-1 ring-orange-500/30 px-1.5 py-0.5 rounded">
            <ShoppingBag className="size-2.5" />
            Product like this
          </span>
        </div>
        <p className="text-[12px] leading-snug line-clamp-2 font-medium">
          {preview.title}
        </p>
        <div className="flex items-center gap-2.5 mt-1 text-[10px] text-muted-foreground tabular-nums">
          <span className="text-[12px] font-bold text-emerald-700 dark:text-emerald-400">
            ${preview.priceUsd.toFixed(2)}
          </span>
          {preview.rating !== undefined && (
            <span className="inline-flex items-center gap-0.5">
              <Star
                className="size-2.5 text-amber-500"
                fill="currentColor"
                strokeWidth={0}
              />
              {preview.rating.toFixed(1)}
            </span>
          )}
          {preview.orderCount !== undefined && preview.orderCount > 0 && (
            <span>{preview.orderCount.toLocaleString()} sold</span>
          )}
        </div>
      </div>

      {/* Chevron arrow */}
      <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
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
        className="w-full h-12 rounded-xl border border-dashed border-border/70 hover:border-border hover:bg-muted/30 transition-colors flex items-center justify-center gap-2 text-[12px] font-bold tracking-wide text-muted-foreground hover:text-foreground disabled:opacity-50"
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
