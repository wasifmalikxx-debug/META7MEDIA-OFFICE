"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Sparkles,
  Target,
  Crown,
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
  Search,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Manual Hunting v2 (May 16 2026, redesigned for product-first UX).
 *
 * Niche → Categories → PRODUCTS (not keywords).
 *
 * Flow:
 *   1. Employee types a niche ("boho jewelry")
 *   2. Optional style + audience pills bias the brainstorm
 *   3. Backend discovers 6-10 proven-selling categories, generates
 *      buyer-intent keywords per category, queries Etsy to validate
 *      demand, queries AliExpress for products, then DEDUPES + QUALITY-
 *      FILTERS to surface only the top 8-12 products per category
 *   4. UI: clean product grid inside each expandable category card —
 *      no keyword cruft, just images + prices + margins + actions
 *
 * Goal: minutes-not-hours from "I want to sell jewelry" to "here are
 * 60+ AE products vetted by quality + Etsy demand, organized by my
 * shop sections."
 */

// ─── Types ──────────────────────────────────────────────────────────

interface CuratedProduct {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceUsd: number;
  recommendedEtsyPrice: number;
  marginUsd: number;
  marginPct: number;
  rating?: number;
  orderCount?: number;
  matchedKeyword: string;
  qualityScore: number;
}

interface NicheCategoryResult {
  category: string;
  products: CuratedProduct[];
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

// ─── Main section ───────────────────────────────────────────────────

export function ManualHuntingSection() {
  const [niche, setNiche] = useState("");
  const [style, setStyle] = useState<string | null>(null);
  const [audience, setAudience] = useState<string | null>(null);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);

  const [hunting, setHunting] = useState(false);
  const [result, setResult] = useState<NicheHuntResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
      const totalProducts = data.productCount ?? 0;
      toast.success(
        `${data.categories.length} categories · ${totalProducts} vetted products`,
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
            <div className="space-y-4">
              {result.categories.map((cat, idx) => (
                <CategoryProductBlock
                  key={cat.category}
                  category={cat}
                  defaultOpen={idx < 3}
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
              We&apos;ll find the proven-selling categories and curate quality
              products from AliExpress for each one.
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

        {/* Style pills (optional) */}
        <details className="group" open>
          <summary className="cursor-pointer list-none flex items-center gap-2">
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Style{" "}
              <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">
                (optional)
              </span>
            </span>
          </summary>
          <div className="flex flex-wrap gap-1.5 mt-3 pl-5">
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
        </details>

        {/* Audience pills (optional) */}
        <details className="group" open>
          <summary className="cursor-pointer list-none flex items-center gap-2">
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Audience{" "}
              <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">
                (optional)
              </span>
            </span>
          </summary>
          <div className="flex flex-wrap gap-1.5 mt-3 pl-5">
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
        </details>

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
            Discovering proven-selling categories · checking Etsy demand
            for each · pulling top AliExpress products · quality-filtering
            · scoring by margin × orders × rating.
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
                <Lightbulb className="size-3.5 text-violet-500" />
                <span className="tabular-nums">{categoryCount}</span>
                <span className="text-muted-foreground font-normal">categories</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold">
                <Package className="size-3.5 text-emerald-500" />
                <span className="tabular-nums">{productCount}</span>
                <span className="text-muted-foreground font-normal">curated products</span>
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
          &rdquo;. Try a more specific niche (e.g. &ldquo;boho jewelry&rdquo;
          instead of &ldquo;jewelry&rdquo;) or check that AliExpress is
          connected.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Category block (header + product grid) ────────────────────────

function CategoryProductBlock({
  category,
  defaultOpen,
}: {
  category: NicheCategoryResult;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className="border border-border/60 shadow-none overflow-hidden ap-stagger-in">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
      >
        <CardContent className="p-4 sm:p-5 flex items-center gap-3.5 hover:bg-muted/30 transition-colors">
          <div className="size-11 rounded-xl bg-gradient-to-br from-sky-500/20 to-violet-500/20 ring-1 ring-violet-500/30 flex items-center justify-center shrink-0">
            <Lightbulb className="size-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold tracking-tight leading-tight">
              {category.category}
            </p>
            <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
              {category.products.length} curated products
              {category.etsyHotKeywords > 0 && (
                <span className="text-emerald-700 dark:text-emerald-400">
                  {" "}
                  · {category.etsyHotKeywords} hot Etsy keyword
                  {category.etsyHotKeywords === 1 ? "" : "s"}
                </span>
              )}
              {category.etsyTotalListings > 0 && (
                <span className="text-muted-foreground/70">
                  {" "}
                  · {category.etsyTotalListings.toLocaleString()} Etsy listings
                </span>
              )}
            </p>
          </div>
          {open ? (
            <ChevronDown className="size-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-5 text-muted-foreground" />
          )}
        </CardContent>
      </button>

      {open && category.products.length > 0 && (
        <div className="border-t border-border/40 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {category.products.map((p, i) => (
              <ProductCard key={p.productId} product={p} rank={i + 1} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Product card ──────────────────────────────────────────────────

function ProductCard({
  product,
  rank,
}: {
  product: CuratedProduct;
  rank: number;
}) {
  const aliExpressUrl =
    product.productUrl ??
    `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(product.matchedKeyword)}`;
  const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(product.matchedKeyword)}`;

  return (
    <div className="group rounded-xl ring-1 ring-border/60 bg-card hover:ring-border hover:shadow-md transition-all overflow-hidden flex flex-col">
      {/* Image */}
      <div className="relative aspect-square bg-muted/40 overflow-hidden">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="size-full flex items-center justify-center">
            <Package className="size-8 text-muted-foreground/40" />
          </div>
        )}

        {/* Rank chip top-left */}
        <div className="absolute top-2 left-2">
          <span
            className={`inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-md text-[10px] font-bold tabular-nums backdrop-blur-md ring-1 ${
              rank === 1
                ? "bg-amber-500/90 text-white ring-amber-500/40"
                : "bg-black/50 text-white ring-white/20"
            }`}
          >
            {rank === 1 ? <Crown className="size-3" /> : `#${rank}`}
          </span>
        </div>

        {/* Quality score top-right */}
        <div className="absolute top-2 right-2">
          <span className="inline-flex items-center h-6 px-1.5 rounded-md text-[10px] font-bold bg-emerald-500/90 text-white backdrop-blur-md ring-1 ring-emerald-500/40">
            {product.qualityScore}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <p className="text-[12px] leading-snug line-clamp-2 font-medium min-h-[2.4em]">
          {product.title}
        </p>

        {/* Stats row */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
          {product.rating !== undefined && (
            <span className="inline-flex items-center gap-0.5">
              <Star
                className="size-2.5 text-amber-500"
                fill="currentColor"
                strokeWidth={0}
              />
              {product.rating.toFixed(1)}
            </span>
          )}
          {product.orderCount !== undefined && product.orderCount > 0 && (
            <span>{product.orderCount.toLocaleString()} sold</span>
          )}
        </div>

        {/* Price + margin */}
        <div className="flex items-end justify-between pt-1.5 border-t border-border/40">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
              AE cost
            </p>
            <p className="text-[15px] font-bold tabular-nums leading-none">
              ${product.priceUsd.toFixed(2)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
              Margin
            </p>
            <p className="text-[15px] font-bold tabular-nums leading-none text-emerald-700 dark:text-emerald-400">
              +${product.marginUsd.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Recommended Etsy price */}
        <p className="text-[10px] text-muted-foreground italic tabular-nums">
          List at <strong className="text-foreground not-italic font-bold">${product.recommendedEtsyPrice.toFixed(2)}</strong> on Etsy
        </p>

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-2 mt-auto">
          <a
            href={aliExpressUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1 h-8 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow shadow-orange-500/30 hover:opacity-90 transition-opacity"
          >
            <ExternalLink className="size-2.5" />
            AliExpress
          </a>
          <a
            href={etsyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1 h-8 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
            title="See on Etsy"
          >
            <Search className="size-2.5" />
            Etsy
          </a>
        </div>
      </div>
    </div>
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
