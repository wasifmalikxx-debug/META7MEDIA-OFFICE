"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Sparkles,
  Target,
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
  ArrowDownNarrowWide,
  ChevronDown,
  Flame,
  LayoutGrid,
  Rows3,
} from "lucide-react";
import { toast } from "sonner";
import { saveRecentHunt } from "./product-hunter-view";

/**
 * Manual Hunting v3.0 — May 16 2026 single-page heatmap redesign.
 *
 * The earlier tab-based layout only let you see one category at a
 * time. The team wanted a zoom-out view across the whole niche, so
 * this version drops tabs entirely:
 *
 *   - Sticky heatmap nav at top: each category as a cell with
 *     verdict-mix dots (●● = how many keywords were GREAT/GOOD/etc.).
 *     Click a cell → smooth-scrolls to that category.
 *   - All categories stacked vertically below, each as its own
 *     section with a 2-3 column grid of keyword cards.
 *   - Each keyword card now has a BIG product preview (4:3 aspect)
 *     instead of the old 64px thumbnail.
 *   - Verdict + score badges overlay on the image (top-left).
 *   - Price/rating/sold counts overlay at image bottom.
 *   - Filter pills (All / GREAT only / GOOD+) + sort dropdown live
 *     in the heatmap nav and apply globally.
 *
 * The hunt logic + API contract are unchanged — only the React
 * component changed. Same data, much denser visual scan.
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

// Style + Audience pill options — expanded May 16 2026 (CEO ask) to
// give sellers a wider lens when narrowing a niche. Order is curated
// for scan-ability: most-common aesthetics first, then niche styles.

const STYLE_OPTIONS = [
  // Mainstream aesthetics
  "Boho",
  "Minimalist",
  "Vintage",
  "Modern",
  "Cottagecore",
  "Coastal",
  // Trend / Gen-Z
  "Y2K",
  "Streetwear",
  "Preppy",
  "Grunge",
  // Premium / craft
  "Maximalist",
  "Glam",
  "Mid-Century",
  "Industrial",
  "Scandi",
  "Japandi",
  // Themed
  "Rustic",
  "Gothic",
  "Art Deco",
  "Eco / Sustainable",
];

const AUDIENCE_OPTIONS = [
  // Gift-by-recipient
  "Gift for Mom",
  "Gift for Dad",
  "Gift for Sister",
  "Gift for Brother",
  "Gift for Wife",
  "Gift for Husband",
  // Occasions
  "Anniversary",
  "Wedding",
  "Engagement",
  "Bridesmaids",
  "Groomsmen",
  "Birthday",
  "Baby Shower",
  "Newborn",
  "Housewarming",
  "Graduation",
  // Calendar
  "Christmas",
  "Valentine's",
  "Mother's Day",
  "Father's Day",
  // Lifestyle / niche
  "Office",
  "Self-gift",
  "Pet Lover",
  "Teen",
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

// ─── Filter + sort ──────────────────────────────────────────────────

type VerdictFilter = "all" | "great" | "goodPlus";
type SortKey = "score" | "listings" | "favorites";
type ViewMode = "grid" | "list";

// Storage key versioned so changing the default below (list) actually
// reaches users who already had "grid" persisted from the v1 toggle.
// Bump this any time you want everyone to re-pick up the default.
const VIEW_MODE_STORAGE_KEY = "manualHunting.viewMode.v2";
const DEFAULT_VIEW_MODE: ViewMode = "list";

const VERDICT_DOT: Record<Verdict, string> = {
  GREAT: "bg-emerald-500",
  GOOD: "bg-sky-500",
  MAYBE: "bg-amber-500",
  SKIP: "bg-rose-400/80",
};

function applyVerdictFilter(
  kws: NicheKeywordResult[],
  filter: VerdictFilter,
): NicheKeywordResult[] {
  if (filter === "all") return kws;
  if (filter === "great") return kws.filter((k) => k.verdict === "GREAT");
  return kws.filter((k) => k.verdict === "GREAT" || k.verdict === "GOOD");
}

function applySort(
  kws: NicheKeywordResult[],
  sortKey: SortKey,
): NicheKeywordResult[] {
  const arr = [...kws];
  if (sortKey === "score") arr.sort((a, b) => b.score - a.score);
  else if (sortKey === "listings")
    arr.sort((a, b) => b.totalListings - a.totalListings);
  else arr.sort((a, b) => b.avgTopFavorites - a.avgTopFavorites);
  return arr;
}

// ─── Main section ───────────────────────────────────────────────────

/**
 * Initial values for niche/style/audience. The parent ProductHunterView
 * passes these when the user clicks a card in the Recent Hunts strip
 * AND uses `key={prefill.timestamp}` to force a remount — so each
 * prefill event becomes a fresh component instance with new defaults.
 *
 * The remount-on-key pattern keeps us within the codebase's "no
 * setState inside useEffect" rule (React 19 best practice). Lazy
 * useState initializers below read these props once per mount.
 */
export function ManualHuntingSection({
  initialNiche = "",
  initialStyle = null,
  initialAudience = null,
}: {
  initialNiche?: string;
  initialStyle?: string | null;
  initialAudience?: string | null;
} = {}) {
  const [niche, setNiche] = useState(initialNiche);
  const [style, setStyle] = useState<string | null>(initialStyle);
  const [audience, setAudience] = useState<string | null>(initialAudience);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);

  const [hunting, setHunting] = useState(false);
  const [result, setResult] = useState<NicheHuntResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Global filter + sort that apply across every category section.
  // Reset when a new niche result lands so the user starts fresh.
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");

  // Grid vs list view. Persisted in localStorage so each user's
  // preference sticks. Read via a function initializer so we don't
  // touch window during SSR. Defaults to DEFAULT_VIEW_MODE ("list",
  // the compact one — user explicitly asked for this) when no
  // preference is stored.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return DEFAULT_VIEW_MODE;
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === "list" || stored === "grid") return stored;
    return DEFAULT_VIEW_MODE;
  });
  const handleViewModeChange = useCallback((next: ViewMode) => {
    setViewMode(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    }
  }, []);

  // Active category tracking — used to highlight the heatmap cell that
  // matches whichever category is currently in the viewport. Updated by
  // an IntersectionObserver on the section refs below.
  const [activeIdx, setActiveIdx] = useState(0);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (result) {
      setActiveIdx(0);
      setVerdictFilter("all");
      setSortKey("score");
      // Truncate refs array to match new category count.
      sectionRefs.current = sectionRefs.current.slice(
        0,
        result.categories.length,
      );
    }
  }, [result]);

  // Highlight the heatmap cell for whichever category is currently
  // dominant in the viewport. The rootMargin shifts the "active" zone
  // upward so headings about to disappear off the top still count as
  // active, which feels more natural than waiting until the next
  // section is centered.
  useEffect(() => {
    if (!result || result.categories.length === 0) return;
    const sections = sectionRefs.current.filter(
      (s): s is HTMLElement => s !== null,
    );
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const idx = Number(
            visible[0].target.getAttribute("data-cat-idx") ?? "0",
          );
          if (!Number.isNaN(idx)) setActiveIdx(idx);
        }
      },
      { threshold: [0.1, 0.3, 0.5], rootMargin: "-140px 0px -45% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [result]);

  const scrollToCategory = useCallback((idx: number) => {
    const el = sectionRefs.current[idx];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
      // Persist to Recent Hunts strip in the hub. Only on successful
      // runs — failures don't clutter the history. Same niche + style
      // + audience signature gets bumped to the top instead of duped.
      saveRecentHunt({
        niche: niche.trim(),
        style,
        audience,
        timestamp: Date.now(),
        categoryCount: data.categories.length,
        productCount: data.productCount,
      });
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
              <HeatmapNav
                categories={result.categories}
                activeIdx={activeIdx}
                onScrollToCategory={scrollToCategory}
                verdictFilter={verdictFilter}
                onVerdictFilterChange={setVerdictFilter}
                sortKey={sortKey}
                onSortKeyChange={setSortKey}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
              />

              {result.categories.map((cat, idx) => (
                <CategorySection
                  key={cat.category}
                  category={cat}
                  idx={idx}
                  verdictFilter={verdictFilter}
                  sortKey={sortKey}
                  viewMode={viewMode}
                  registerRef={(el) => {
                    sectionRefs.current[idx] = el;
                  }}
                />
              ))}

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

// Quick-start niches the team has run successfully — clicking one
// fills the input. Picked to span jewelry / clothing / home / pets /
// kitchen / baby so the seller sees the range of what works.
const QUICK_START_NICHES = [
  "boho jewelry",
  "home decor lamps",
  "mens linen clothing",
  "newborn baby clothing",
  "kitchen organizer",
  "pet supplies",
];

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
  const NICHE_MAX = 80;
  const hasAnyFilter = style !== null || audience !== null;

  return (
    <Card className="border border-border/60 bg-card/95 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_12px_36px_-12px_rgba(0,0,0,0.5)] ap-stagger-in overflow-hidden relative">
      {/* Soft aurora wash in the corner to match the dark hero above */}
      <div
        aria-hidden
        className="absolute -top-24 -right-16 size-64 rounded-full blur-3xl opacity-40"
        style={{
          background:
            "radial-gradient(closest-side, rgba(168,85,247,0.18), rgba(168,85,247,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-20 -left-16 size-56 rounded-full blur-3xl opacity-40"
        style={{
          background:
            "radial-gradient(closest-side, rgba(34,211,238,0.16), rgba(34,211,238,0) 70%)",
        }}
      />

      <CardContent className="relative p-7 sm:p-9 space-y-6">
        {/* Centered hero header */}
        <div className="text-center space-y-2.5">
          <div className="relative inline-block">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-2xl bg-gradient-to-br from-sky-400/35 to-violet-500/35 blur-lg ap-orb-pulse"
            />
            <div className="relative size-14 rounded-2xl bg-gradient-to-br from-sky-500 to-violet-600 ring-1 ring-violet-700/30 flex items-center justify-center shadow-lg shadow-violet-500/30 mx-auto">
              <Search className="size-6 text-white" />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-[0.22em]">
              Start here
            </p>
            <h3 className="text-2xl sm:text-[26px] font-bold tracking-tight leading-tight mt-1">
              What&apos;s your shop&apos;s niche?
            </h3>
            <p className="text-[12.5px] sm:text-[13px] text-muted-foreground/80 mt-2 leading-relaxed max-w-xl mx-auto">
              We&apos;ll find the proven-selling categories, the keywords
              real buyers search, and curated AliExpress products for each
              one.
            </p>
          </div>
        </div>

        {/* Niche input with inline char counter */}
        <div className="space-y-2">
          <div className="relative">
            <Input
              type="text"
              value={niche}
              onChange={(e) => onNicheChange(e.target.value.slice(0, NICHE_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !disabled) onHunt();
              }}
              placeholder="e.g. boho jewelry · mens linen · pet supplies · kitchen organizer"
              disabled={disabled}
              maxLength={NICHE_MAX}
              className="h-14 sm:h-16 text-base pr-16 bg-muted/20 border-border/70 focus-visible:border-sky-500/60 focus-visible:ring-sky-500/15 placeholder:text-muted-foreground/55"
            />
            {niche.length > 0 && (
              <span
                className={`absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold tabular-nums tracking-wider ${
                  niche.length >= NICHE_MAX - 5
                    ? "text-rose-500"
                    : "text-muted-foreground/60"
                }`}
              >
                {niche.length}/{NICHE_MAX}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/70 leading-snug px-0.5">
            Tip: a niche works best when it spans multiple shop sections.
            &ldquo;Boho jewelry&rdquo; works; &ldquo;earrings&rdquo; alone
            is too narrow.
          </p>
        </div>

        {/* Quick-start niches — click to fill input */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Try one of these
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_START_NICHES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => onNicheChange(ex)}
                disabled={disabled}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-medium bg-muted/30 ring-1 ring-border/50 text-foreground/80 hover:bg-card hover:ring-border hover:text-foreground transition-colors disabled:opacity-50"
              >
                <Sparkles className="size-2.5 text-violet-500" />
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Style + Audience pills with selected-count indicators */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Style{" "}
              <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">
                (optional)
              </span>
              {style && (
                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30 text-[9px] font-bold normal-case tracking-normal">
                  {style}
                </span>
              )}
            </p>
            {hasAnyFilter && (
              <button
                type="button"
                onClick={() => {
                  onStyleChange(null);
                  onAudienceChange(null);
                }}
                disabled={disabled}
                className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
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
            {audience && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30 text-[9px] font-bold normal-case tracking-normal">
                {audience}
              </span>
            )}
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

// ─── Heatmap nav (sticky) ──────────────────────────────────────────
//
// The replacement for the old single-row tab bar. Each cell is a
// mini-dashboard for one category: name, total keyword count, a row
// of verdict-colored dots (one dot per keyword), and a footer with
// "hot" count + Etsy listing volume. Click → smooth scrolls to that
// section. Active section gets a brighter ring (driven by the
// IntersectionObserver in the parent component).
//
// The nav also hosts the global filter + sort controls so the user
// has access to them no matter how far they've scrolled.

function HeatmapNav({
  categories,
  activeIdx,
  onScrollToCategory,
  verdictFilter,
  onVerdictFilterChange,
  sortKey,
  onSortKeyChange,
  viewMode,
  onViewModeChange,
}: {
  categories: NicheCategoryResult[];
  activeIdx: number;
  onScrollToCategory: (idx: number) => void;
  verdictFilter: VerdictFilter;
  onVerdictFilterChange: (v: VerdictFilter) => void;
  sortKey: SortKey;
  onSortKeyChange: (v: SortKey) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
}) {
  return (
    <div className="sticky top-3 z-20 ap-stagger-in">
      <div className="rounded-2xl bg-card/85 backdrop-blur-xl ring-1 ring-border/60 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.12)] dark:shadow-[0_4px_28px_-8px_rgba(0,0,0,0.6)] p-3 sm:p-4 space-y-3">
        {/* Header row — title + filter/sort/view */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground inline-flex items-center gap-1.5">
            <Target className="size-3 text-violet-500" />
            Categories
            <span className="text-foreground/60 font-bold tabular-nums">
              · {categories.length}
            </span>
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <FilterPills value={verdictFilter} onChange={onVerdictFilterChange} />
            <SortDropdown value={sortKey} onChange={onSortKeyChange} />
            <ViewToggle value={viewMode} onChange={onViewModeChange} />
          </div>
        </div>

        {/* Heatmap cells grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
          {categories.map((cat, idx) => (
            <HeatmapCell
              key={cat.category}
              cat={cat}
              active={idx === activeIdx}
              onClick={() => onScrollToCategory(idx)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HeatmapCell({
  cat,
  active,
  onClick,
}: {
  cat: NicheCategoryResult;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl text-left p-2.5 transition-all ring-1 overflow-hidden ${
        active
          ? "ring-violet-500/50 bg-gradient-to-br from-sky-500/[0.10] to-violet-500/[0.10] shadow-md"
          : "ring-border/40 bg-muted/15 hover:ring-border hover:bg-muted/30"
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <p
          className={`text-[11px] font-bold tracking-tight leading-tight truncate ${
            active ? "text-foreground" : "text-foreground/85"
          }`}
        >
          {cat.category}
        </p>
        <span className="shrink-0 text-[9px] font-bold tabular-nums text-muted-foreground bg-foreground/5 rounded px-1 py-0.5">
          {cat.totalProducts}
        </span>
      </div>

      {/* Verdict-mix dots — one dot per keyword, color = verdict */}
      <div className="flex items-center gap-0.5 mt-1.5 flex-wrap">
        {cat.keywords.map((kw, i) => (
          <span
            key={i}
            className={`block size-1.5 rounded-full ${VERDICT_DOT[kw.verdict]}`}
            title={`${kw.keyword} · ${kw.verdict}`}
          />
        ))}
      </div>

      {/* Footer — hot count + Etsy volume */}
      <p className="text-[9px] tabular-nums text-muted-foreground mt-1.5 truncate">
        {cat.etsyHotKeywords > 0 && (
          <span className="text-emerald-700 dark:text-emerald-400 font-bold inline-flex items-center gap-0.5">
            <Flame className="size-2.5" />
            {cat.etsyHotKeywords} hot ·{" "}
          </span>
        )}
        {formatCount(cat.etsyTotalListings)} listings
      </p>
    </button>
  );
}

function FilterPills({
  value,
  onChange,
}: {
  value: VerdictFilter;
  onChange: (v: VerdictFilter) => void;
}) {
  const options: { label: string; value: VerdictFilter }[] = [
    { label: "All", value: "all" },
    { label: "GREAT", value: "great" },
    { label: "GOOD+", value: "goodPlus" },
  ];
  return (
    <div className="inline-flex items-center bg-muted/30 ring-1 ring-border/40 rounded-full p-0.5 text-[10px] font-bold">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`h-6 px-2.5 rounded-full transition-all tracking-wide ${
              active
                ? "bg-card text-foreground shadow ring-1 ring-border/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SortDropdown({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className="appearance-none h-7 pl-7 pr-7 rounded-full bg-muted/30 ring-1 ring-border/40 text-[10px] font-bold tracking-wide cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-colors"
        aria-label="Sort keywords"
      >
        <option value="score">Sort: Score</option>
        <option value="listings">Sort: Listings</option>
        <option value="favorites">Sort: Favorites</option>
      </select>
      <ArrowDownNarrowWide className="size-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
      <ChevronDown className="size-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
    </div>
  );
}

// Text + icon segmented toggle for list vs grid view. List is the
// default — way more keywords visible per screen. Preference is
// persisted to localStorage so each user gets their layout back on
// reload.
function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const options: {
    value: ViewMode;
    icon: typeof LayoutGrid;
    label: string;
  }[] = [
    { value: "list", icon: Rows3, label: "List" },
    { value: "grid", icon: LayoutGrid, label: "Grid" },
  ];
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center bg-muted/30 ring-1 ring-border/40 rounded-full p-0.5 text-[10px] font-bold"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-label={`${opt.label} view`}
            aria-pressed={active}
            className={`h-6 inline-flex items-center gap-1 px-2.5 rounded-full tracking-wide transition-all ${
              active
                ? "bg-card text-foreground shadow ring-1 ring-border/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Category section (anchor-scrolled) ────────────────────────────
//
// Each category gets its own section with a stable data-cat-idx so
// the IntersectionObserver in ManualHuntingSection can highlight the
// matching heatmap cell as it scrolls into view. `scroll-mt-32`
// offsets the heading below the sticky nav when a cell is clicked.

function CategorySection({
  category,
  idx,
  verdictFilter,
  sortKey,
  viewMode,
  registerRef,
}: {
  category: NicheCategoryResult;
  idx: number;
  verdictFilter: VerdictFilter;
  sortKey: SortKey;
  viewMode: ViewMode;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const visible = useMemo(() => {
    const filtered = applyVerdictFilter(category.keywords, verdictFilter);
    return applySort(filtered, sortKey);
  }, [category.keywords, verdictFilter, sortKey]);

  return (
    <section
      ref={registerRef}
      data-cat-idx={idx}
      id={`hunt-cat-${idx}`}
      className="space-y-3 ap-stagger-in scroll-mt-32"
    >
      {/* Header strip */}
      <div className="flex items-end justify-between gap-3 px-1 pt-1">
        <div className="min-w-0">
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight leading-tight">
            {category.category}
          </h3>
          <p className="text-[12px] text-muted-foreground tabular-nums mt-0.5">
            {visible.length === category.keywords.length ? (
              <>
                {category.keywords.length} keyword
                {category.keywords.length === 1 ? "" : "s"}
              </>
            ) : (
              <>
                {visible.length} of {category.keywords.length} shown
              </>
            )}
            {category.etsyHotKeywords > 0 && (
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
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

      {/* Keyword grid or list */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/15 py-6 px-4 text-center">
          <p className="text-[12px] text-muted-foreground">
            No keywords match the current filter.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3.5">
          {visible.map((kw) => (
            <KeywordCard key={kw.keyword} keyword={kw} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((kw) => (
            <KeywordRow key={kw.keyword} keyword={kw} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Keyword card (vertical grid card) ─────────────────────────────
//
// New v3 design — Pinterest-style card with a big 4:3 product preview
// on top, verdict + score overlay badges, price/rating/sold ribbon at
// the bottom of the image, then keyword + Etsy stats + action buttons
// below. Built for the 2-3 column grid layout so several cards live
// side-by-side instead of stacking vertically.

function KeywordCard({ keyword }: { keyword: NicheKeywordResult }) {
  const verdictStyle = VERDICT_STYLE[keyword.verdict];

  const aliExpressUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword.keyword)}`;
  const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(keyword.keyword)}`;
  // Clicking the image jumps to the actual product when we have one,
  // otherwise to a keyword search on AliExpress (still useful).
  const imageHref = keyword.preview?.productUrl ?? aliExpressUrl;

  return (
    <Card className="border border-border/60 shadow-none overflow-hidden ap-stagger-in group transition-shadow hover:shadow-lg flex flex-col">
      {/* Product preview — big 4:3 image with overlays */}
      <a
        href={imageHref}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-[4/3] bg-muted/40 overflow-hidden"
        title={keyword.preview?.title ?? keyword.keyword}
      >
        {keyword.preview?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={keyword.preview.imageUrl}
            alt=""
            className="size-full object-cover group-hover:scale-[1.035] transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="size-full flex flex-col items-center justify-center gap-1.5 text-muted-foreground/45">
            <Package className="size-7" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              No preview
            </span>
          </div>
        )}

        {/* Verdict + score overlay (top-left) */}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] ${verdictStyle.chip} ring-1 ${verdictStyle.ringBorder} shadow-sm`}
          >
            {verdictStyle.label}
          </span>
          <span className="inline-flex items-center text-[10px] font-bold tabular-nums text-foreground bg-white/95 dark:bg-black/70 backdrop-blur-md px-1.5 py-1 rounded-md ring-1 ring-border/40">
            {keyword.score}
          </span>
        </div>

        {/* Price / rating / sold ribbon (bottom of image) */}
        {keyword.preview && (
          <div className="absolute bottom-0 inset-x-0 px-2.5 py-1.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent flex items-center gap-2.5 text-[10px] text-white tabular-nums">
            <span className="text-[12px] font-bold text-emerald-300">
              ${keyword.preview.priceUsd.toFixed(2)}
            </span>
            {keyword.preview.rating !== undefined && (
              <span className="inline-flex items-center gap-0.5">
                <Star
                  className="size-2.5 text-amber-300"
                  fill="currentColor"
                  strokeWidth={0}
                />
                {keyword.preview.rating.toFixed(1)}
              </span>
            )}
            {keyword.preview.orderCount !== undefined &&
              keyword.preview.orderCount > 0 && (
                <span>{keyword.preview.orderCount.toLocaleString()} sold</span>
              )}
          </div>
        )}
      </a>

      {/* Card body — keyword + stats + actions */}
      <div className="p-3.5 sm:p-4 flex flex-col gap-2.5 flex-1">
        <h4 className="text-[14px] font-bold tracking-tight leading-snug line-clamp-2">
          {keyword.keyword}
        </h4>

        <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1" title="Etsy listings">
            <TrendingUp className="size-2.5" />
            {formatCount(keyword.totalListings)}
          </span>
          <span className="inline-flex items-center gap-1" title="Avg top favorites">
            <Heart className="size-2.5" />
            {formatCount(keyword.avgTopFavorites)}
          </span>
          <span className="inline-flex items-center gap-1" title="Unique shops">
            <Users className="size-2.5" />
            {keyword.uniqueShops}
          </span>
        </div>

        <div className="flex items-center gap-1.5 pt-1 mt-auto">
          <a
            href={aliExpressUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1 h-8 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow shadow-orange-500/20 hover:opacity-90 transition-opacity"
            title={`Hunt "${keyword.keyword}" on AliExpress`}
          >
            <ShoppingBag className="size-3" />
            AliExpress
          </a>
          <a
            href={etsyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1 h-8 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
            title={`See "${keyword.keyword}" on Etsy`}
          >
            <Search className="size-3" />
            Etsy
          </a>
        </div>
      </div>
    </Card>
  );
}

// ─── Keyword row (compact list view) ───────────────────────────────
//
// One thin row per keyword, ~56-60px tall on desktop. Way denser than
// the grid card — you can see 12-15 keywords on screen at once. The
// row reads left to right:
//   [verdict stripe] [48px thumb] [GREAT 87] [keyword text] [Etsy stats]
//   [price + ⭐ + sold] [AE/Etsy actions]
// All on a single line on desktop. On narrow screens the Etsy stats
// hide first, then the preview meta drops to a second line.

function KeywordRow({ keyword }: { keyword: NicheKeywordResult }) {
  const verdictStyle = VERDICT_STYLE[keyword.verdict];
  const aliExpressUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword.keyword)}`;
  const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(keyword.keyword)}`;
  const imageHref = keyword.preview?.productUrl ?? aliExpressUrl;

  // Verdict tint for the far-left stripe — same color family as the
  // chip but full saturation so it pops at this size.
  const stripeColor: Record<Verdict, string> = {
    GREAT: "bg-emerald-500",
    GOOD: "bg-sky-500",
    MAYBE: "bg-amber-500",
    SKIP: "bg-rose-400",
  };

  return (
    <div className="group flex items-stretch rounded-lg border border-border/60 bg-card overflow-hidden ap-stagger-in transition-colors hover:bg-muted/20">
      {/* Verdict color stripe */}
      <span
        aria-hidden
        className={`w-1 shrink-0 ${stripeColor[keyword.verdict]}`}
      />

      {/* 48px square thumbnail */}
      <a
        href={imageHref}
        target="_blank"
        rel="noopener noreferrer"
        className="relative shrink-0 size-12 sm:size-14 bg-muted/40 overflow-hidden self-stretch"
        title={keyword.preview?.title ?? keyword.keyword}
      >
        {keyword.preview?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={keyword.preview.imageUrl}
            alt=""
            className="size-full object-cover group-hover:scale-[1.06] transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="size-full flex items-center justify-center text-muted-foreground/40">
            <Package className="size-4" />
          </div>
        )}
      </a>

      {/* Main content area */}
      <div className="flex-1 min-w-0 flex items-center gap-2.5 sm:gap-3 px-2.5 sm:px-3 py-1.5">
        {/* Verdict chip + score — compact stack */}
        <div className="shrink-0 flex flex-col items-center justify-center gap-0.5 w-10 sm:w-12">
          <span
            className={`inline-flex items-center justify-center w-full rounded text-[8px] font-bold uppercase tracking-[0.12em] px-0.5 py-0.5 ${verdictStyle.chip} ring-1 ${verdictStyle.ringBorder} leading-none`}
          >
            {verdictStyle.label}
          </span>
          <span className="text-[11px] font-bold tabular-nums leading-none">
            {keyword.score}
          </span>
        </div>

        {/* Keyword + (optional) preview meta */}
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-bold tracking-tight leading-tight truncate">
            {keyword.keyword}
          </h4>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums mt-0.5">
            {keyword.preview ? (
              <>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">
                  ${keyword.preview.priceUsd.toFixed(2)}
                </span>
                {keyword.preview.rating !== undefined && (
                  <span className="inline-flex items-center gap-0.5">
                    <Star
                      className="size-2.5 text-amber-500"
                      fill="currentColor"
                      strokeWidth={0}
                    />
                    {keyword.preview.rating.toFixed(1)}
                  </span>
                )}
                {keyword.preview.orderCount !== undefined &&
                  keyword.preview.orderCount > 0 && (
                    <span className="truncate hidden sm:inline">
                      {keyword.preview.orderCount.toLocaleString()} sold
                    </span>
                  )}
              </>
            ) : (
              <span className="italic text-muted-foreground/60">
                No preview
              </span>
            )}
          </div>
        </div>

        {/* Etsy stats — hidden on small screens */}
        <div className="hidden lg:flex items-center gap-2.5 shrink-0 text-[10px] text-muted-foreground tabular-nums">
          <span
            className="inline-flex items-center gap-1"
            title="Etsy listings"
          >
            <TrendingUp className="size-2.5" />
            {formatCount(keyword.totalListings)}
          </span>
          <span
            className="inline-flex items-center gap-1"
            title="Avg top favorites"
          >
            <Heart className="size-2.5" />
            {formatCount(keyword.avgTopFavorites)}
          </span>
          <span
            className="inline-flex items-center gap-1"
            title="Unique shops"
          >
            <Users className="size-2.5" />
            {keyword.uniqueShops}
          </span>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1">
          <a
            href={aliExpressUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1 h-7 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow-sm shadow-orange-500/20 hover:opacity-90 transition-opacity"
            title={`Hunt "${keyword.keyword}" on AliExpress`}
          >
            <ShoppingBag className="size-3" />
            <span className="hidden md:inline">AliExpress</span>
          </a>
          <a
            href={etsyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1 h-7 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
            title={`See "${keyword.keyword}" on Etsy`}
          >
            <Search className="size-3" />
            <span className="hidden md:inline">Etsy</span>
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
