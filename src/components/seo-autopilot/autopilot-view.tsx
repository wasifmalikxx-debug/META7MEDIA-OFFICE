"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sparkles,
  Wand2,
  Copy,
  Check,
  ChevronDown,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Ban,
  Hash,
  RotateCw,
  Heart,
  ImageIcon,
  Shuffle,
  Ruler,
  Palette,
  Type,
  ListChecks,
  Lightbulb,
  Crown,
  Eye,
  XCircle,
  Search,
  PenLine,
  Zap,
  Target,
  Award,
  Gauge,
  Clock,
  Activity,
  Sparkle,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { SeoImageUploader, type UploadedImage } from "./image-uploader";
import { SizeSelector, VariantSelector } from "./option-selectors";
import { GEN_COMPLETE_EVENT } from "./seo-autopilot-hero";

// ─── API response shape (preserved — backend untouched) ─────────────

interface ComplianceVerdict {
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  concerns: Array<{
    severity: "block" | "warn";
    category: "trademark" | "prohibited" | "counterfeit" | "policy" | "quality";
    details: string;
  }>;
  summary: string;
}
interface GeneratedListing {
  title: string;
  description: string;
  tags: string[];
  altTexts: string[];
  rationale: {
    keywordFocus: string;
    titleStrategy: string;
    audienceHook: string;
  };
}
type TagTier = "niche" | "moderate" | "hot" | "saturated";
interface TagDemand {
  tag: string;
  totalListings: number;
  topFavorites: number[];
  avgTopFavorites: number;
  demandScore: number;
  tier: TagTier;
  error?: string;
}
interface ResearchSummary {
  searchKeyword: string;
  productType: string;
  audienceHint: string;
  styleHint: string;
  categoryPath: string;
  categoryId: number;
  competitorsAnalyzed: number;
  topCompetitors: { rank: number; title: string; favorites: number }[];
}
interface UserInputsEcho {
  sizes: string[];
  variants: string[];
}
interface KeywordFrequency {
  phrase: string;
  count: number;
  percentage: number;
}
interface AnchorKeywords {
  topPhrases: KeywordFrequency[];
  topTags: KeywordFrequency[];
  totalListings: number;
}
/** Reframe metadata — present when the rule engine or vision flagged
 * the source product as IP / brand / commodity / personalisation
 * risk. The generated listing was produced WITH constraints that
 * stripped those flags. UI uses this to show an "IP-adjusted" badge
 * + the photo regen guidance for the team's identity-shot pass. */
interface ReframeMeta {
  flaggedRules: Array<{
    label: string;
    matchedText: string;
    policyClause: string;
  }>;
  avoidWords: string[];
  photoGuidance: {
    dont: string[];
    do: string[];
  };
}

interface GenerateResponse {
  compliance: ComplianceVerdict;
  listing: GeneratedListing | null;
  research: ResearchSummary;
  anchorKeywords?: AnchorKeywords;
  tagIntelligence?: TagDemand[];
  reframe?: ReframeMeta | null;
  inputs?: UserInputsEcho;
  generatedAt: string;
}

// ─── Usage / quota types ────────────────────────────────────────────

interface UsageSummary {
  count: number;
  limit: number;
  remaining: number;
  resetAt: string;
  isUnlimited: boolean;
  date: string;
}

// ─── User history types ────────────────────────────────────────────

interface SavedListing {
  title: string;
  description: string;
  tags: string[];
  altTexts: string[];
  rationale: {
    keywordFocus: string;
    titleStrategy: string;
    audienceHook: string;
  };
  categoryPath: string;
  categoryId: number;
  searchKeyword: string;
  productType: string;
  audienceHint: string;
  styleHint: string;
}

interface MyHistoryEntry {
  id: string;
  createdAt: string;
  sourceTitle: string;
  generatedTitle: string | null;
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  category: string | null;
  costUsd: number;
  sizes: string[];
  variants: string[];
  listing: SavedListing | null;
}


type Stage =
  | "idle"
  | "reading"
  | "checking"
  | "researching"
  | "writing"
  | "auditing";

// ─── Constants ──────────────────────────────────────────────────────

const TITLE_MAX = 140;
const TAG_MAX = 20;

const TIER_GLYPH: Record<TagTier, string> = {
  niche: "🌱",
  moderate: "📊",
  hot: "🔥",
  saturated: "⚠️",
};
const TIER_STYLE: Record<TagTier, string> = {
  niche:
    "bg-sky-100 text-sky-700 ring-sky-300/50 dark:bg-sky-950/40 dark:text-sky-300",
  moderate:
    "bg-emerald-100 text-emerald-700 ring-emerald-300/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  hot: "bg-amber-100 text-amber-800 ring-amber-300/50 dark:bg-amber-950/40 dark:text-amber-300",
  saturated:
    "bg-rose-100 text-rose-700 ring-rose-300/50 dark:bg-rose-950/40 dark:text-rose-300",
};
const TIER_DESCRIPTION: Record<TagTier, string> = {
  niche: "<1k listings — easy to rank, low traffic",
  moderate: "1k-10k listings — sweet spot for most shops",
  hot: "10k-50k listings — high demand, high competition",
  saturated: ">50k — very hard to rank as a new shop",
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ─── Main component ─────────────────────────────────────────────────

/**
 * SEO Autopilot — premium redesign (May 14 2026).
 *
 * Full-bleed hero with animated aurora background, single combined input
 * panel with two sub-cards (source + variations), cinematic generation
 * panel with an orbiting central orb, and a staggered result reveal with
 * subtle motion on every section. Insights drawer animates its bars and
 * cards in on open.
 *
 * Backend contract is untouched — same POST /api/seo-autopilot/generate
 * with { aliExpressTitle, images, sizes, variants, specifications }, same response shape.
 */
export function SeoAutopilotView({ isCeo = false }: { isCeo?: boolean }) {
  // ─── Form state ───────────────────────────────────────────────────
  const [aliTitle, setAliTitle] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [variants, setVariants] = useState<string[]>([]);
  const [specs, setSpecs] = useState("");

  // ─── Generation state ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ─── Quota state ──────────────────────────────────────────────────
  // Just the user-facing usage chip ("3 / 8 today"). The full team
  // analytics dashboard lives at /seo-autopilot/dashboard (CEO-only).
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  // ─── User history state ─────────────────────────────────────────
  // Current PKT calendar month of THIS user's own generations. Used
  // by the "Your recent generations" section. Resets on the 1st of
  // every month at PKT midnight.
  const [history, setHistory] = useState<MyHistoryEntry[]>([]);
  const [historyWindowLabel, setHistoryWindowLabel] = useState<string>("");
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchUsage = async () => {
      try {
        const res = await fetch("/api/seo-autopilot/usage", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.usage) setUsage(data.usage);
      } catch {
        // Silent — UI just doesn't show the chip
      }
    };
    const fetchHistory = async () => {
      try {
        const res = await fetch("/api/seo-autopilot/my-history", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.entries)) setHistory(data.entries);
        if (typeof data.windowLabel === "string")
          setHistoryWindowLabel(data.windowLabel);
      } catch {
        // Silent — history section just stays empty
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    fetchUsage();
    fetchHistory();
    return () => {
      cancelled = true;
    };
    // Re-fetch when result.generatedAt changes (after a successful gen)
    // so both the chip + history list stay accurate.
  }, [result?.generatedAt]);

  // Restore a past generation into the current result panel — no API
  // call, no quota usage, just rehydrate the same shape the result
  // panel expects from the saved snapshot.
  const handleRestoreHistory = (entry: MyHistoryEntry) => {
    if (!entry.listing) {
      toast.error("This generation has no saved listing", {
        description: "BLOCKED gens don't store output.",
      });
      return;
    }
    const l = entry.listing;
    const restored: GenerateResponse = {
      compliance: {
        verdict: entry.verdict,
        concerns: [],
        summary:
          entry.verdict === "ALLOWED"
            ? "Cleared to list (restored from history)."
            : "Review warnings (restored from history).",
      },
      listing: {
        title: l.title,
        description: l.description,
        tags: l.tags,
        altTexts: l.altTexts,
        rationale: l.rationale,
      },
      research: {
        searchKeyword: l.searchKeyword,
        productType: l.productType,
        audienceHint: l.audienceHint,
        styleHint: l.styleHint,
        categoryPath: l.categoryPath,
        categoryId: l.categoryId,
        competitorsAnalyzed: 0,
        topCompetitors: [],
      },
      anchorKeywords: { topPhrases: [], topTags: [], totalListings: 0 },
      tagIntelligence: [],
      inputs: {
        sizes: entry.sizes,
        variants: entry.variants,
      },
      generatedAt: entry.createdAt,
    };
    setResult(restored);
    setSizes(entry.sizes);
    setVariants(entry.variants);
    setSpecs("");
    setErrorMsg(null);
    toast.success("Restored from history", {
      description: relativeFromNow(entry.createdAt),
    });
    // Scroll to top so the result panel is visible
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const atLimit =
    !!usage && !usage.isUnlimited && usage.remaining <= 0;
  const titleValid = aliTitle.trim().length >= 8;
  const imagesValid = images.length >= 1;
  const canSubmit = titleValid && imagesValid && !generating && !atLimit;

  async function handleGenerate() {
    if (!canSubmit) return;
    setGenerating(true);
    setErrorMsg(null);
    setResult(null);
    setStage("reading");

    const t1 = setTimeout(() => setStage("checking"), 1500);
    const t2 = setTimeout(() => setStage("researching"), 6000);
    const t3 = setTimeout(() => setStage("writing"), 10000);
    const t4 = setTimeout(() => setStage("auditing"), 25000);

    try {
      const res = await fetch("/api/seo-autopilot/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aliExpressTitle: aliTitle.trim(),
          images: images.map((i) => ({
            base64: i.base64,
            mediaType: i.mediaType,
          })),
          sizes,
          variants,
          specifications: specs.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Quota gate — refresh local usage state and surface a clear
        // message. The body includes { quotaExceeded, limit, resetAt }.
        if (res.status === 429 && body?.quotaExceeded) {
          setUsage({
            count: body.limit ?? 8,
            limit: body.limit ?? 8,
            remaining: 0,
            resetAt: body.resetAt ?? new Date().toISOString(),
            isUnlimited: false,
            date: new Date().toISOString().slice(0, 10),
          });
          throw new Error(
            body?.error ??
              "Daily limit reached. Resets at midnight Pakistan time.",
          );
        }
        throw new Error(body?.error ?? `Generation failed (${res.status})`);
      }

      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStage("idle");

      // Tell the hero quota chip to refresh — a slot was consumed.
      // The hero (in seo-autopilot-hero.tsx) listens for this event
      // and refetches /api/seo-autopilot/usage. No prop plumbing.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(GEN_COMPLETE_EVENT));
      }

      if (data.compliance.verdict === "BLOCKED") {
        toast.error("Product blocked", {
          description: data.compliance.summary,
        });
      } else if (data.compliance.verdict === "REVIEW") {
        toast.warning("Listing ready — review warnings", {
          description: data.compliance.summary,
        });
      } else {
        toast.success("Listing ready", {
          description: data.research.categoryPath || "Cleared for Etsy.",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setErrorMsg(message);
      toast.error("Generation failed", { description: message });
      setStage("idle");
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      setGenerating(false);
    }
  }

  function handleReset() {
    setAliTitle("");
    setImages([]);
    setSizes([]);
    setVariants([]);
    setSpecs("");
    setResult(null);
    setErrorMsg(null);
  }

  const showInput = !generating && !result;
  const showResult =
    !!result && !generating && result.compliance.verdict !== "BLOCKED" && !!result.listing;

  return (
    <div className="relative">
      {/* Page background — radial gradient + dot mesh that's barely there.
          The hero used to live here (full-bleed) — moved to page.tsx
          May 18 2026 to match the Calculator / Product Hunter / Product
          Validator pattern (page handles layout + hero, view is content
          only). The PageBackdrop stays here because it tracks the
          radial gradient at the viewport level. */}
      <PageBackdrop />

      {/* Content width adapts based on state — narrow for input/cinema
          (focused single-column flow), wider once a result lands so the
          insights sidebar has room on desktop without crowding. */}
      <div
        className={`relative mx-auto space-y-6 pb-16 transition-[max-width] ${
          showResult ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
        {/* ──────────────── INPUT ──────────────── */}
        {showInput && (
          <div className="max-w-3xl mx-auto space-y-5 ap-stagger-in" style={{ animationDelay: "120ms" }}>
            <SourceCard
              aliTitle={aliTitle}
              onAliTitleChange={setAliTitle}
              images={images}
              onImagesChange={setImages}
              disabled={generating}
              titleValid={titleValid}
              imagesValid={imagesValid}
            />
            <SpecsCard
              specs={specs}
              onSpecsChange={setSpecs}
              disabled={generating}
            />
            <VariationsCard
              sizes={sizes}
              onSizesChange={setSizes}
              variants={variants}
              onVariantsChange={setVariants}
              disabled={generating}
            />
            <GenerateCta
              canSubmit={canSubmit}
              generating={generating}
              titleValid={titleValid}
              imagesValid={imagesValid}
              hasAnyInput={
                aliTitle.length > 0 ||
                images.length > 0 ||
                sizes.length > 0 ||
                variants.length > 0 ||
                specs.length > 0
              }
              usage={usage}
              atLimit={atLimit}
              onGenerate={handleGenerate}
              onReset={handleReset}
            />
          </div>
        )}

        {/* ──────────────── RECENT GENERATIONS ──────────────── */}
        {/* Shown only when no generation is in-flight and no result is
            currently displayed — keeps the input flow focused. */}
        {showInput && !historyLoading && history.length > 0 && (
          <div className="max-w-3xl mx-auto">
            <MyHistorySection
              entries={history}
              windowLabel={historyWindowLabel}
              onRestore={handleRestoreHistory}
              isCeo={isCeo}
            />
          </div>
        )}

        {/* ──────────────── GENERATING ──────────────── */}
        {generating && (
          <div className="max-w-3xl mx-auto">
            <GenerationCinema stage={stage} />
          </div>
        )}

        {/* ──────────────── ERROR ──────────────── */}
        {errorMsg && !generating && (
          <div className="max-w-3xl mx-auto">
            <ErrorPanel message={errorMsg} />
          </div>
        )}

        {/* ──────────────── BLOCKED ──────────────── */}
        {result &&
          !generating &&
          result.compliance.verdict === "BLOCKED" && (
            <div className="max-w-3xl mx-auto">
              <BlockedPanel verdict={result.compliance} onReset={handleReset} />
            </div>
          )}

        {/* ──────────────── RESULT (with sidebar) ──────────────── */}
        {/* On desktop (lg+) the listing sits on the left and the
            Insights panel docks on the right as a sticky sidebar — like
            eRank's keyword analyzer. On smaller screens the insights
            stack below the result. */}
        {showResult && result && (
          <>
            <div
              key={result.generatedAt}
              className="grid grid-cols-1 lg:grid-cols-5 gap-5"
            >
              <div className="lg:col-span-3 min-w-0">
                <ResultPanel data={result} userImages={images} />
              </div>
              <aside className="lg:col-span-2 lg:sticky lg:top-4 lg:self-start min-w-0">
                <InsightsDrawer data={result} />
              </aside>
            </div>
            <div className="max-w-3xl mx-auto w-full">
              <RestartButton onReset={handleReset} />
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─── Page backdrop — radial wash that anchors the premium feel ──────

function PageBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -top-10 -z-0 overflow-hidden"
    >
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 size-[1200px] rounded-full opacity-30 dark:opacity-20 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(241,100,30,0.18), rgba(124,58,237,0.10) 55%, transparent 75%)",
        }}
      />
    </div>
  );
}

// HeroBanner + UsagePill + FeatureCell removed May 18 2026 —
// extracted into src/components/seo-autopilot/seo-autopilot-hero.tsx
// so SEO Autopilot matches the page-level structure the rest of the
// Etsy Tools use (Calculator + Product Hunter + Product Validator):
// page renders <SeoAutopilotHero /> + <SeoAutopilotView /> as
// siblings, hero is self-contained.

// ─── Source card ────────────────────────────────────────────────────

function SourceCard({
  aliTitle,
  onAliTitleChange,
  images,
  onImagesChange,
  disabled,
  titleValid,
  imagesValid,
}: {
  aliTitle: string;
  onAliTitleChange: (v: string) => void;
  images: UploadedImage[];
  onImagesChange: (imgs: UploadedImage[]) => void;
  disabled: boolean;
  titleValid: boolean;
  imagesValid: boolean;
}) {
  return (
    <PremiumCard>
      <CardContent className="p-6 sm:p-8 space-y-6">
        <StepHeader
          stepN={1}
          title="Product details"
          subtitle="Source title and product photos used to generate the listing."
          required
        />

        {/* ── AliExpress title ── */}
        <div className="space-y-2.5">
          <SectionLabel icon={Type} required filled={titleValid}>
            AliExpress title
          </SectionLabel>
          <div className="relative">
            <Textarea
              value={aliTitle}
              onChange={(e) => onAliTitleChange(e.target.value)}
              placeholder="Paste the original AliExpress product title."
              className="min-h-[110px] resize-none text-sm leading-relaxed bg-muted/20 border-border/70 focus-visible:border-orange-500/60 focus-visible:ring-orange-500/15 transition-colors placeholder:text-muted-foreground/55"
              disabled={disabled}
            />
            {/* Char counter floating in bottom-right */}
            <div className="absolute bottom-2.5 right-3 text-[10px] font-bold tabular-nums text-muted-foreground/60 bg-card/80 backdrop-blur-sm rounded px-1.5 py-0.5">
              {aliTitle.length}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground/75 leading-snug">
            Used to extract the target keyword, category, audience, and style.
          </p>
        </div>

        {/* ── Product images ── */}
        <div className="space-y-2.5">
          <SectionLabel icon={ImageIcon} required filled={imagesValid}>
            Product images
          </SectionLabel>

          {/* Image-source policy notice — raw AliExpress photos get
              auto-flagged by the vision compliance gate as copyrighted
              content (Etsy is strict here, and Claude vision catches
              stock-photo watermarks + brand logos). Keeps the seller
              from burning a quota slot on a guaranteed BLOCKED listing. */}
          <AliWarningBanner />

          <SeoImageUploader
            images={images}
            onChange={onImagesChange}
            disabled={disabled}
          />
          <p className="text-[11px] text-muted-foreground/75 leading-snug">
            Used for compliance review and alt-text generation. AI-regenerated images only.
          </p>
        </div>
      </CardContent>
    </PremiumCard>
  );
}

// ─── AliExpress image warning banner ────────────────────────────────

/**
 * Image-source advisory shown above the uploader. Calm, professional,
 * single-card rose accent — no diagonal tape, no pulsing halo. Still
 * unmissable because of the rose tint + leading icon, but presented as
 * a policy notice rather than a panic alert. The compliance gate will
 * block raw AliExpress images anyway; this notice stops the upload
 * before a quota slot is consumed.
 */
function AliWarningBanner() {
  return (
    <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/20 px-4 py-3 flex items-start gap-3">
      <div className="size-7 rounded-md bg-rose-500/10 ring-1 ring-rose-500/25 flex items-center justify-center shrink-0 mt-0.5">
        <AlertTriangle className="size-3.5 text-rose-600 dark:text-rose-400" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold text-rose-700 dark:text-rose-300 uppercase tracking-[0.18em]">
          Image source policy
        </p>
        <p className="text-[13px] font-semibold text-rose-900 dark:text-rose-100 leading-tight mt-0.5">
          Upload AI-regenerated images only.
        </p>
        <p className="text-[11.5px] text-rose-800/85 dark:text-rose-200/85 mt-1 leading-relaxed">
          Raw AliExpress photos are auto-flagged as copyrighted content. The listing will be blocked and one daily generation consumed.
        </p>
      </div>
    </div>
  );
}

// ─── Specifications card ─────────────────────────────────────────────
//
// Optional. The seller pastes the product's real specs/features (straight
// from the AliExpress supplier listing). These become the verified source of
// truth for the DESCRIPTION + the "Features" list — accurate, specific copy
// instead of generic guesses. Title + tags are unaffected.

function SpecsCard({
  specs,
  onSpecsChange,
  disabled,
}: {
  specs: string;
  onSpecsChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <PremiumCard>
      <CardContent className="p-6 sm:p-8 space-y-4">
        <StepHeader
          stepN={2}
          title="Product specifications & features"
          subtitle="Optional — paste the real specs from the supplier listing. The description and Features list are built from these for accurate, specific copy."
        />
        <div className="space-y-2.5">
          <SectionLabel icon={ListChecks}>Specifications & features</SectionLabel>
          <div className="relative">
            <Textarea
              value={specs}
              onChange={(e) => onSpecsChange(e.target.value)}
              placeholder={
                "Paste the product's real specs & features, one per line — e.g.\nMaterial: faux leather\nClosure: front zipper\nFit: cropped slim fit\nCollar: turn-down\nSleeves: long with zip cuffs\nCare: wipe clean"
              }
              className="min-h-[150px] resize-none text-sm leading-relaxed bg-muted/20 border-border/70 focus-visible:border-orange-500/60 focus-visible:ring-orange-500/15 transition-colors placeholder:text-muted-foreground/55"
              disabled={disabled}
            />
            <div className="absolute bottom-2.5 right-3 text-[10px] font-bold tabular-nums text-muted-foreground/60 bg-card/80 backdrop-blur-sm rounded px-1.5 py-0.5">
              {specs.length}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground/75 leading-snug">
            Drives the description and the Features list — the more real detail you paste, the more specific and convincing the copy. Title and tags are unaffected.
          </p>
        </div>
      </CardContent>
    </PremiumCard>
  );
}

// ─── Variations card ────────────────────────────────────────────────

function VariationsCard({
  sizes,
  onSizesChange,
  variants,
  onVariantsChange,
  disabled,
}: {
  sizes: string[];
  onSizesChange: (s: string[]) => void;
  variants: string[];
  onVariantsChange: (s: string[]) => void;
  disabled: boolean;
}) {
  return (
    <PremiumCard>
      <CardContent className="p-6 sm:p-8 space-y-6">
        <StepHeader
          stepN={3}
          title="Product variations"
          subtitle="Sizes and options available to buyers."
        />

        <div className="space-y-2.5">
          <SectionLabel icon={Ruler}>Available sizes</SectionLabel>
          <SizeSelector
            values={sizes}
            onChange={onSizesChange}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2.5">
          <SectionLabel icon={Palette}>Available variants</SectionLabel>
          <VariantSelector
            values={variants}
            onChange={onVariantsChange}
            disabled={disabled}
          />
        </div>
      </CardContent>
    </PremiumCard>
  );
}

// ─── Card wrapper ───────────────────────────────────────────────────
//
// Matches the Price Calculator: clean `border shadow-none`, no
// backdrop-blur, no gradient highlight. The visual lift now comes from
// the hero above and the warmth of the page backdrop, not from heavy
// per-card chrome.

function PremiumCard({ children }: { children: React.ReactNode }) {
  return <Card className="border shadow-none">{children}</Card>;
}

// ─── Step header ────────────────────────────────────────────────────
//
// Calculator-flat replacement for the previous big orange→violet
// gradient step circle. Reads like a section heading on a SaaS form:
//   • small step chip (neutral)
//   • clean h2 title
//   • subdued subtitle below
//   • optional `Required` pill inline with the title

function StepHeader({
  stepN,
  title,
  subtitle,
  required,
}: {
  stepN: number;
  title: string;
  subtitle: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="inline-flex items-center justify-center size-6 rounded-md bg-muted text-foreground/80 text-[11px] font-semibold tabular-nums ring-1 ring-border/60">
          {stepN}
        </span>
        <h2 className="text-[15px] sm:text-base font-semibold tracking-tight leading-tight">
          {title}
        </h2>
        {required && (
          <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400 leading-none">
            Required
          </span>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground leading-snug pl-[34px]">
        {subtitle}
      </p>
    </div>
  );
}

// ─── Section label ──────────────────────────────────────────────────
//
// Calculator-style inline label: `text-[11px] font-semibold uppercase
// tracking-[0.16em]` + small icon + optional asterisk. The "filled"
// state used to swap the icon chip to a green check; we now show a
// small emerald check at the end of the label instead — same signal,
// flatter visual.

function SectionLabel({
  children,
  icon: Icon,
  required,
  filled,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  required?: boolean;
  filled?: boolean;
}) {
  return (
    <label className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em] flex items-center gap-1.5">
      {Icon && <Icon className="size-3 text-muted-foreground/70" />}
      <span>{children}</span>
      {required && (
        <span
          className="text-rose-500 dark:text-rose-400 normal-case tracking-normal font-bold leading-none"
          aria-label="required"
          title="Required"
        >
          *
        </span>
      )}
      {filled && (
        <Check
          className="size-3 text-emerald-600 dark:text-emerald-400 ml-0.5"
          strokeWidth={3}
        />
      )}
    </label>
  );
}

// ─── Generate CTA ────────────────────────────────────────────────────

function GenerateCta({
  canSubmit,
  generating,
  titleValid,
  imagesValid,
  hasAnyInput,
  usage,
  atLimit,
  onGenerate,
  onReset,
}: {
  canSubmit: boolean;
  generating: boolean;
  titleValid: boolean;
  imagesValid: boolean;
  hasAnyInput: boolean;
  usage: UsageSummary | null;
  atLimit: boolean;
  onGenerate: () => void;
  onReset: () => void;
}) {
  // If the user is at their daily cap, render a clear limit card
  // instead of the Generate button. No way to even try to submit.
  if (atLimit && usage) {
    return (
      <div className="space-y-3 ap-stagger-in" style={{ animationDelay: "240ms" }}>
        <DailyLimitCard usage={usage} />
        {hasAnyInput && (
          <button
            type="button"
            onClick={onReset}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center gap-1.5 py-1"
          >
            <RotateCw className="size-3" />
            Clear inputs anyway
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 ap-stagger-in" style={{ animationDelay: "240ms" }}>
      <div className="relative group">
        {/* Soft glow that intensifies on hover */}
        <div
          aria-hidden
          className={`absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-[#F1641E] via-pink-500 to-violet-600 blur-md opacity-50 group-hover:opacity-75 transition-opacity ${canSubmit ? "" : "opacity-0 group-hover:opacity-0"}`}
        />
        <Button
          type="button"
          onClick={onGenerate}
          disabled={!canSubmit}
          className="relative w-full h-16 gap-3 bg-gradient-to-r from-[#F1641E] via-orange-500 to-violet-600 hover:from-[#F1641E] hover:via-orange-500 hover:to-violet-600 text-white font-bold text-[15px] tracking-wide rounded-2xl shadow-xl shadow-orange-500/30 ring-1 ring-orange-700/30 hover:shadow-2xl hover:shadow-orange-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {generating ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              Generating listing…
            </>
          ) : (
            <>
              <Wand2 className="size-5" />
              <span>Generate Listing</span>
              <span className="ml-1 text-xs font-semibold opacity-80 hidden sm:inline">
                · 25–40s
              </span>
            </>
          )}
        </Button>
      </div>

      {/* Usage status line beneath the button — only shown to capped users */}
      {!generating && usage && !usage.isUnlimited && (
        <p className="text-center text-[11px] font-semibold text-muted-foreground tabular-nums flex items-center justify-center gap-1.5">
          <Gauge className="size-3" />
          {usage.remaining} of {usage.limit} generations remaining today · resets at midnight PKT
        </p>
      )}

      {!generating && aliTitleHasContent(titleValid, imagesValid) && (
        <div className="space-y-1">
          {!titleValid && (
            <ValidationLine text="Enter at least 8 characters in the title." />
          )}
          {!imagesValid && (
            <ValidationLine text="Upload at least one product image." />
          )}
        </div>
      )}

      {hasAnyInput && !generating && (
        <button
          type="button"
          onClick={onReset}
          className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center gap-1.5 py-1"
        >
          <RotateCw className="size-3" />
          Reset all fields
        </button>
      )}
    </div>
  );
}

function DailyLimitCard({ usage }: { usage: UsageSummary }) {
  // Absolute reset time, formatted in Pakistan TZ. We deliberately skip
  // a live "X hours from now" countdown — React 19's purity rules make
  // it noisy to maintain and the absolute time is easier to read anyway.
  const resetDate = new Date(usage.resetAt);

  return (
    <Card className="relative overflow-hidden border-rose-300/50 dark:border-rose-900/40 shadow-xl shadow-rose-500/15">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-rose-50/60 via-card to-amber-50/40 dark:from-rose-950/30 dark:via-card dark:to-amber-950/15"
      />
      <CardContent className="relative p-6 sm:p-7 space-y-4">
        <div className="flex items-center gap-3.5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-1 rounded-2xl bg-rose-500/25 blur-md"
            />
            <div className="relative size-12 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 ring-1 ring-rose-800/30 flex items-center justify-center shadow-lg shadow-rose-500/30">
              <Gauge className="size-5 text-white" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.22em]">
              Daily limit reached
            </p>
            <h3 className="text-lg font-bold leading-tight">
              {usage.count} of {usage.limit} generations today
            </h3>
          </div>
        </div>

        <div className="rounded-xl bg-card/60 ring-1 ring-rose-200/40 dark:ring-rose-900/40 px-4 py-3 flex items-center gap-3">
          <Clock className="size-4 text-rose-600 dark:text-rose-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-rose-700/80 dark:text-rose-300/80">
              Resets at midnight (PKT)
            </p>
            <p className="text-[13px] font-semibold mt-0.5">
              {resetDate.toLocaleString("en-PK", {
                timeZone: "Asia/Karachi",
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}{" "}
              <span className="text-muted-foreground font-medium">PKT</span>
            </p>
          </div>
        </div>

        <p className="text-[12px] text-foreground/80 leading-relaxed">
          Everyone gets {usage.limit} listing generations per day to keep
          shared resources (Etsy API + Claude) fair. Your count resets at
          Pakistan midnight automatically — no action needed.
        </p>
      </CardContent>
    </Card>
  );
}

function aliTitleHasContent(titleValid: boolean, imagesValid: boolean): boolean {
  // Show validation lines whenever ANY required field is invalid.
  return !titleValid || !imagesValid;
}

function ValidationLine({ text }: { text: string }) {
  return (
    <p className="text-[11px] text-amber-700 dark:text-amber-400 text-center flex items-center justify-center gap-1.5">
      <AlertTriangle className="size-3" />
      {text}
    </p>
  );
}

// ─── Generation cinema — animated orb + step list ───────────────────

function GenerationCinema({ stage }: { stage: Stage }) {
  const order: Stage[] = ["reading", "checking", "researching", "writing", "auditing"];
  const idx = order.indexOf(stage);
  const labels: Record<Exclude<Stage, "idle">, { title: string; sub: string; icon: React.ComponentType<{ className?: string }>}> = {
    reading: {
      title: "Reading your title",
      sub: "Extracting keyword · category · audience",
      icon: Eye,
    },
    checking: {
      title: "Compliance check",
      sub: "Scanning images + title for IP issues",
      icon: ShieldCheck,
    },
    researching: {
      title: "Researching Etsy",
      sub: "Pulling top 20 ranking listings live",
      icon: Search,
    },
    writing: {
      title: "Writing your listing",
      sub: "Title · 13 tags · description · alt text",
      icon: PenLine,
    },
    auditing: {
      title: "Final polish",
      sub: "Tag intelligence + tier badges",
      icon: Zap,
    },
  };

  // Elapsed seconds — gives the panel a live, breathing feel.
  // React 19 purity: don't call Date.now() in render. Seed the ref with
  // 0, then capture the real start time inside useEffect on mount.
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  useEffect(() => {
    startRef.current = Date.now();
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  return (
    <PremiumCard>
      <CardContent className="relative p-8 sm:p-10 overflow-hidden">
        {/* Background gradient breathing */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-orange-50/50 via-transparent to-violet-50/40 dark:from-orange-950/15 dark:via-transparent dark:to-violet-950/15"
        />
        <div
          aria-hidden
          className="absolute -top-32 -left-20 size-[300px] rounded-full blur-3xl ap-aurora-1 opacity-50"
          style={{
            background:
              "radial-gradient(closest-side, rgba(241,100,30,0.5), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -right-20 size-[340px] rounded-full blur-3xl ap-aurora-2 opacity-50"
          style={{
            background:
              "radial-gradient(closest-side, rgba(124,58,237,0.45), transparent 70%)",
          }}
        />

        <div className="relative flex flex-col items-center text-center">
          {/* Central orb */}
          <div className="relative size-32 sm:size-36 mb-6">
            {/* Outer halo — pulsing */}
            <div
              aria-hidden
              className="absolute -inset-6 rounded-full bg-gradient-to-br from-orange-400/30 to-violet-500/30 blur-2xl ap-orb-pulse"
            />
            {/* Orbiting ring 1 */}
            <div
              aria-hidden
              className="absolute inset-0 rounded-full ring-2 ring-orange-400/30 ap-orb-spin"
              style={{ borderTopColor: "rgba(241,100,30,0.8)" }}
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 size-3 rounded-full bg-orange-500 shadow-lg shadow-orange-500/60" />
            </div>
            {/* Orbiting ring 2 (slower, reverse) */}
            <div
              aria-hidden
              className="absolute inset-3 rounded-full ring-2 ring-violet-400/30 ap-orb-spin"
              style={{
                animationDirection: "reverse",
                animationDuration: "11s",
              }}
            >
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 size-2.5 rounded-full bg-violet-500 shadow-lg shadow-violet-500/60" />
            </div>
            {/* Core */}
            <div className="absolute inset-7 rounded-full bg-gradient-to-br from-[#F1641E] via-orange-500 to-violet-600 ring-1 ring-white/30 flex items-center justify-center shadow-2xl shadow-orange-500/40">
              <Sparkles className="size-7 text-white" />
            </div>
          </div>

          <p className="text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-[0.22em] mb-1">
            Autopilot is working
          </p>
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight">
            {idx >= 0 ? labels[order[idx] as Exclude<Stage, "idle">].title : "Starting"}
          </h3>
          <p className="text-[13px] text-muted-foreground mt-1.5 max-w-xs">
            {idx >= 0
              ? labels[order[idx] as Exclude<Stage, "idle">].sub
              : "Spinning up Autopilot…"}
          </p>

          {/* Elapsed time */}
          <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80 tabular-nums">
            <Loader2 className="size-3 animate-spin" />
            <span>{elapsed}s elapsed · usually 25–40s with images</span>
          </div>
        </div>

        {/* Step list */}
        <div className="relative mt-8 grid gap-1.5">
          {order.map((s, i) => {
            const done = i < idx;
            const active = i === idx;
            const Icon = labels[s as Exclude<Stage, "idle">].icon;
            return (
              <div
                key={s}
                className={`relative flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                  active
                    ? "bg-orange-50/60 dark:bg-orange-950/20 ring-1 ring-orange-500/30"
                    : done
                      ? "bg-emerald-50/40 dark:bg-emerald-950/10"
                      : "bg-muted/20"
                }`}
              >
                {/* Step indicator */}
                <div className="relative shrink-0">
                  {done ? (
                    <div className="size-8 rounded-full bg-emerald-500 ring-1 ring-emerald-600/30 flex items-center justify-center shadow-sm shadow-emerald-500/30">
                      <Check className="size-4 text-white" strokeWidth={3} />
                    </div>
                  ) : active ? (
                    <>
                      <span
                        aria-hidden
                        className="absolute -inset-1 rounded-full bg-orange-400/40 blur-md animate-pulse"
                      />
                      <div className="relative size-8 rounded-full bg-gradient-to-br from-orange-500 to-violet-600 ring-1 ring-orange-700/30 flex items-center justify-center shadow-md shadow-orange-500/30">
                        <Loader2 className="size-4 text-white animate-spin" />
                      </div>
                    </>
                  ) : (
                    <div className="size-8 rounded-full bg-muted/60 ring-1 ring-border flex items-center justify-center">
                      <Icon className="size-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>

                {/* Step label */}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[13px] font-semibold leading-tight ${
                      done || active ? "text-foreground" : "text-muted-foreground/60"
                    }`}
                  >
                    {labels[s as Exclude<Stage, "idle">].title}
                  </p>
                  <p
                    className={`text-[11px] leading-tight mt-0.5 ${
                      done || active ? "text-muted-foreground" : "text-muted-foreground/50"
                    }`}
                  >
                    {labels[s as Exclude<Stage, "idle">].sub}
                  </p>
                </div>

                {/* Shimmer on active row */}
                {active && (
                  <div
                    aria-hidden
                    className="absolute inset-y-0 right-0 w-1/3 overflow-hidden rounded-r-xl pointer-events-none"
                  >
                    <div
                      className="absolute inset-y-0 w-full ap-shimmer"
                      style={{
                        background:
                          "linear-gradient(to right, transparent, rgba(241,100,30,0.18), transparent)",
                      }}
                    />
                  </div>
                )}

                {/* Step number marker on the right */}
                <span className="shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground/40 tracking-wider">
                  {String(i + 1).padStart(2, "0")} / {String(order.length).padStart(2, "0")}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </PremiumCard>
  );
}

// ─── Error panel ────────────────────────────────────────────────────

function ErrorPanel({ message }: { message: string }) {
  return (
    <Card className="border-rose-300/50 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 shadow-none ap-stagger-in">
      <CardContent className="p-5 flex items-start gap-3">
        <div className="size-9 rounded-xl bg-rose-500/20 ring-1 ring-rose-500/40 flex items-center justify-center shrink-0">
          <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-rose-900 dark:text-rose-200">
            Generation failed
          </p>
          <p className="text-[12px] text-rose-700/90 dark:text-rose-300/80 mt-1 leading-relaxed">
            {message}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Blocked panel ──────────────────────────────────────────────────

function BlockedPanel({
  verdict,
  onReset,
}: {
  verdict: ComplianceVerdict;
  onReset: () => void;
}) {
  return (
    <Card className="border-rose-400 dark:border-rose-700 bg-rose-50/60 dark:bg-rose-950/30 shadow-xl shadow-rose-500/10 ap-stagger-in overflow-hidden">
      <CardContent className="p-7 sm:p-8 space-y-5">
        <div className="flex items-center gap-3.5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-1 rounded-2xl bg-rose-500/30 blur-md animate-pulse"
            />
            <div className="relative size-12 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 ring-1 ring-rose-800/30 flex items-center justify-center shadow-lg shadow-rose-500/30">
              <Ban className="size-6 text-white" />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.22em]">
              Blocked by compliance gate
            </p>
            <h3 className="text-xl font-bold text-rose-900 dark:text-rose-200 leading-tight">
              Do not list this on Etsy
            </h3>
          </div>
        </div>

        <p className="text-sm text-foreground leading-relaxed">
          {verdict.summary}
        </p>

        <div className="space-y-2.5">
          <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.18em]">
            Why
          </p>
          <ul className="space-y-1.5">
            {verdict.concerns.map((c, i) => (
              <li
                key={i}
                className="text-[12px] text-foreground/90 flex gap-2 items-start"
              >
                <span className="mt-1 size-1.5 rounded-full bg-rose-500 shrink-0" />
                <span>
                  <span className="font-bold uppercase text-[10px] tracking-wider opacity-70 mr-1.5">
                    {c.category}
                  </span>
                  {c.details}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-rose-700/90 dark:text-rose-300/80 leading-snug border-t border-rose-300/40 dark:border-rose-700/40 pt-3.5">
          Etsy can remove listings within hours of detecting IP/policy issues
          and may strike the shop. Source a different version of this product
          or pick something else to list.
        </p>

        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          className="w-full h-11 gap-2 text-sm font-semibold border-dashed border-rose-300/60 hover:border-solid hover:bg-rose-100/50 dark:hover:bg-rose-900/20"
        >
          <RotateCw className="size-4" />
          Try a different product
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Result panel ────────────────────────────────────────────────────

function ResultPanel({
  data,
  userImages,
}: {
  data: GenerateResponse;
  userImages: UploadedImage[];
}) {
  const { listing, compliance, research, inputs, reframe } = data;

  const [tags, setTags] = useState<string[]>(listing?.tags ?? []);
  const [tagIntel, setTagIntel] = useState<TagDemand[]>(
    data.tagIntelligence ?? [],
  );

  if (!listing) return null;

  const hasVariations =
    (inputs?.sizes.length ?? 0) > 0 || (inputs?.variants.length ?? 0) > 0;

  function handleSwapTag(oldTag: string, newSuggestion: SwapSuggestion) {
    setTags((prev) => prev.map((t) => (t === oldTag ? newSuggestion.tag : t)));
    setTagIntel((prev) => {
      const without = prev.filter((t) => t.tag !== oldTag);
      const next: TagDemand = {
        tag: newSuggestion.tag,
        totalListings: newSuggestion.totalListings,
        topFavorites: [],
        avgTopFavorites: newSuggestion.avgTopFavorites,
        demandScore: 0,
        tier: newSuggestion.tier,
      };
      return [...without, next];
    });
    toast.success("Tag swapped", {
      description: `${oldTag} → ${newSuggestion.tag}`,
    });
  }

  return (
    <PremiumCard>
      <CardContent className="p-7 sm:p-9 space-y-1">
        {/* Header */}
        <div
          className="flex flex-wrap items-start justify-between gap-3 pb-5 mb-1 border-b border-border/60 ap-stagger-in"
          style={{ animationDelay: "0ms" }}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="relative shrink-0">
              <span
                aria-hidden
                className="absolute -inset-1 rounded-2xl bg-emerald-400/30 blur-md"
              />
              <div className="relative size-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 ring-1 ring-emerald-700/30 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                <ShieldCheck className="size-5 text-white" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.22em]">
                Generated listing
              </p>
              <h3 className="text-xl font-bold tracking-tight leading-tight mt-0.5">
                Ready to paste into Etsy
              </h3>
            </div>
          </div>
          <ComplianceChip verdict={compliance} />
        </div>

        {/* Decision strip */}
        <div className="ap-stagger-in" style={{ animationDelay: "100ms" }}>
          <DecisionStrip research={research} />
        </div>

        {/* REVIEW warnings */}
        {compliance.verdict === "REVIEW" && compliance.concerns.length > 0 && (
          <div className="ap-stagger-in" style={{ animationDelay: "150ms" }}>
            <WarningStrip
              title="Review before listing"
              issues={compliance.concerns.map((c) => ({
                severity: c.severity,
                label: c.category,
                message: c.details,
              }))}
            />
          </div>
        )}

        {/* IP-adjusted banner — present when the rule engine or vision
            flagged the source product and Sonnet generated with reframe
            constraints. Tells the team WHAT was stripped + WHY. */}
        {reframe && (
          <div className="ap-stagger-in" style={{ animationDelay: "175ms" }}>
            <ReframeBanner reframe={reframe} />
          </div>
        )}

        {/* Title */}
        <div className="ap-stagger-in" style={{ animationDelay: "200ms" }}>
          <TitleRow title={listing.title} />
        </div>

        {/* Description */}
        <div className="ap-stagger-in" style={{ animationDelay: "300ms" }}>
          <DescriptionRow description={listing.description} />
        </div>

        {/* Variations */}
        {hasVariations && inputs && (
          <>
            <Divider />
            <div className="ap-stagger-in" style={{ animationDelay: "400ms" }}>
              <VariationsRow sizes={inputs.sizes} variants={inputs.variants} />
            </div>
          </>
        )}

        <Divider />

        {/* Tags */}
        <div className="ap-stagger-in" style={{ animationDelay: "500ms" }}>
          <TagsRow
            tags={tags}
            intelligence={tagIntel}
            productTitle={research.searchKeyword}
            productType={research.productType}
            category={research.categoryPath}
            onSwap={handleSwapTag}
          />
        </div>

        <Divider />

        {/* Alt text */}
        <div className="ap-stagger-in" style={{ animationDelay: "650ms" }}>
          <AltTextRow altTexts={listing.altTexts} images={userImages} />
        </div>

        {/* Photo regen guidance — only when reframe ran. Tells the
            team what NOT to recreate in the identity-shot pass + safer
            alternatives, mirroring the validator's photo guidance. */}
        {reframe &&
          (reframe.photoGuidance.dont.length > 0 ||
            reframe.photoGuidance.do.length > 0) && (
            <>
              <Divider />
              <div
                className="ap-stagger-in"
                style={{ animationDelay: "750ms" }}
              >
                <PhotoGuidanceRow guidance={reframe.photoGuidance} />
              </div>
            </>
          )}
      </CardContent>
    </PremiumCard>
  );
}

// ─── Reframe banner — shown when Sonnet generated with policy constraints

function ReframeBanner({ reframe }: { reframe: ReframeMeta }) {
  const topFlag = reframe.flaggedRules[0];
  return (
    <div className="my-3 rounded-xl border border-violet-300/40 dark:border-violet-700/30 bg-gradient-to-br from-violet-50/70 via-violet-50/40 to-emerald-50/40 dark:from-violet-950/30 dark:via-violet-950/15 dark:to-emerald-950/15 p-4">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <span
            aria-hidden
            className="absolute -inset-1 rounded-xl bg-violet-500/30 blur-md"
          />
          <div className="relative size-9 rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 ring-1 ring-violet-700/30 flex items-center justify-center shadow shadow-violet-500/30">
            <ShieldCheck className="size-4 text-white" />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-violet-500 text-white">
              IP-adjusted
            </span>
            <p className="text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
              Generated with Etsy-safe constraints
            </p>
          </div>
          <p className="text-[12.5px] leading-relaxed text-foreground/90">
            {topFlag
              ? `The source title hit "${topFlag.matchedText}" (${topFlag.label} · ${topFlag.policyClause}). We rewrote the title, tags, and description to pass Etsy's automated scans.`
              : "The source product was flagged by Etsy's policy rules. We rewrote the title, tags, and description to pass Etsy's automated scans."}
          </p>
          {reframe.avoidWords.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-700/70 dark:text-violet-300/70 mb-1.5">
                Words stripped from the output
              </p>
              <div className="flex flex-wrap gap-1">
                {reframe.avoidWords.slice(0, 10).map((word, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-md bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/25 line-through decoration-rose-500/60"
                  >
                    {word}
                  </span>
                ))}
                {reframe.avoidWords.length > 10 && (
                  <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 text-muted-foreground">
                    +{reframe.avoidWords.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Photo regen guidance — do / don't for the identity-shot pass ───

function PhotoGuidanceRow({
  guidance,
}: {
  guidance: { dont: string[]; do: string[] };
}) {
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Photo regeneration guidance
        </p>
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30">
          <Eye className="size-2.5" />
          Vision analysed
        </span>
      </div>
      <p className="text-[11.5px] text-muted-foreground leading-relaxed">
        Use these notes during your identity-shot pass — the photos you
        upload to Etsy must not recreate the IP-bound elements in the
        source images.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {guidance.dont.length > 0 && (
          <div className="rounded-lg bg-rose-500/8 ring-1 ring-rose-500/25 p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 inline-flex items-center gap-1">
              <XCircle className="size-3" strokeWidth={3} />
              Do not recreate
            </p>
            <ul className="space-y-1.5">
              {guidance.dont.map((item, i) => (
                <li
                  key={i}
                  className="text-[11.5px] leading-snug text-foreground/85 flex gap-2 items-start"
                >
                  <span className="mt-1 size-1 rounded-full bg-rose-500 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {guidance.do.length > 0 && (
          <div className="rounded-lg bg-emerald-500/8 ring-1 ring-emerald-500/25 p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
              <Check className="size-3" strokeWidth={3} />
              Use instead
            </p>
            <ul className="space-y-1.5">
              {guidance.do.map((item, i) => (
                <li
                  key={i}
                  className="text-[11.5px] leading-snug text-foreground/85 flex gap-2 items-start"
                >
                  <span className="mt-1 size-1 rounded-full bg-emerald-500 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Result building blocks ─────────────────────────────────────────

function ComplianceChip({ verdict }: { verdict: ComplianceVerdict }) {
  if (verdict.verdict === "ALLOWED") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30 px-3 py-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 tracking-[0.18em] uppercase shrink-0">
        <ShieldCheck className="size-3.5" />
        Cleared
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 px-3 py-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 tracking-[0.18em] uppercase shrink-0">
      <AlertTriangle className="size-3.5" />
      Review
    </div>
  );
}

function DecisionStrip({ research }: { research: ResearchSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-4 mb-1">
      <DecisionChip label="Searched" value={research.searchKeyword} icon={Search} />
      <DecisionChip label="Category" value={research.categoryPath} icon={Target} />
      <DecisionChip
        label="Read"
        value={`${research.competitorsAnalyzed} listings`}
        icon={Eye}
      />
      {research.audienceHint && (
        <DecisionChip label="Audience" value={research.audienceHint} icon={Heart} />
      )}
    </div>
  );
}

function DecisionChip({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/40 ring-1 ring-border/60 px-2.5 py-1.5 max-w-full">
      <Icon className="size-3 text-muted-foreground/70 shrink-0" />
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">
        {label}
      </span>
      <span className="text-[11px] font-semibold text-foreground truncate">
        {value}
      </span>
    </span>
  );
}

function WarningStrip({
  title,
  issues,
}: {
  title: string;
  issues: Array<{ severity: "warn" | "block"; label: string; message: string }>;
}) {
  return (
    <div className="mt-3 mb-1 rounded-xl border border-amber-300/50 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/15 px-4 py-3">
      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-[0.18em] mb-1.5">
        {title}
      </p>
      <ul className="space-y-1">
        {issues.map((i, idx) => (
          <li key={idx} className="text-[11px] flex gap-2 items-start">
            <span
              className={`mt-1 size-1.5 rounded-full shrink-0 ${
                i.severity === "block" ? "bg-rose-500" : "bg-amber-500"
              }`}
            />
            <span>
              <span className="font-bold uppercase text-[9px] tracking-wider opacity-70 mr-1">
                {i.label}
              </span>
              {i.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Divider() {
  return <div className="my-3 border-t border-border/40" />;
}

function TitleRow({ title }: { title: string }) {
  const pct = (title.length / TITLE_MAX) * 100;
  const tone =
    pct > 100
      ? ("rose" as const)
      : pct >= 80
        ? ("emerald" as const)
        : pct >= 50
          ? ("amber" as const)
          : ("muted" as const);
  const toneClass = {
    rose: "bg-rose-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    muted: "bg-muted-foreground/40",
  } as const;
  const toneText = {
    rose: "text-rose-600 dark:text-rose-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    muted: "text-muted-foreground",
  } as const;

  return (
    <div className="py-4">
      <div className="relative overflow-hidden rounded-2xl border border-orange-500/15 bg-gradient-to-br from-orange-50/70 via-card to-violet-50/50 dark:from-orange-950/20 dark:via-card dark:to-violet-950/15 ring-1 ring-orange-500/10 shadow-sm shadow-orange-500/5">
        {/* Subtle inner shimmer line */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-400/40 to-transparent"
        />
        <div className="p-5 sm:p-6 space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-gradient-to-br from-orange-500/20 to-violet-500/20 ring-1 ring-orange-500/30 flex items-center justify-center">
                <Type className="size-4 text-orange-600 dark:text-orange-400" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-700/85 dark:text-orange-300/85">
                Title
              </p>
            </div>
            <CopyButton value={title} label="title" />
          </div>
          <p
            className="text-base sm:text-lg font-semibold leading-snug break-words text-foreground ap-text-reveal"
            style={{ animationDelay: "250ms" }}
          >
            {title}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-muted/60 overflow-hidden">
              <div
                className={`h-full ap-bar-fill ${toneClass[tone]}`}
                style={{ ["--bar-w" as string]: `${Math.min(100, pct)}%` }}
              />
            </div>
            <p
              className={`text-[11px] font-bold tabular-nums ${toneText[tone]}`}
            >
              {title.length} / {TITLE_MAX}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DescriptionRow({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > 320;
  return (
    <div className="py-4 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Description
          </p>
          <span className="text-[10px] tabular-nums font-medium text-muted-foreground/60">
            · {description.length} chars
          </span>
        </div>
        <CopyButton value={description} label="description" />
      </div>
      <div
        className={`rounded-xl border border-border/60 bg-muted/15 px-4 py-3.5 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90 relative ${
          expanded || !isLong ? "" : "max-h-[180px] overflow-hidden"
        }`}
      >
        {description}
        {!expanded && isLong && (
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card via-card/70 to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
        >
          <ChevronDown
            className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Collapse" : "Read full description"}
        </button>
      )}
    </div>
  );
}

function VariationsRow({
  sizes,
  variants,
}: {
  sizes: string[];
  variants: string[];
}) {
  return (
    <div className="py-4 space-y-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
        Variations
      </p>
      {sizes.length > 0 && <ChipDisplay label="Sizes" values={sizes} copyAll />}
      {variants.length > 0 && (
        <ChipDisplay label="Variants" values={variants} copyAll />
      )}
    </div>
  );
}

function ChipDisplay({
  label,
  values,
  copyAll,
}: {
  label: string;
  values: string[];
  copyAll?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.16em] mr-1">
        {label}
      </span>
      {values.map((v, idx) => (
        <span
          key={v}
          className="inline-flex items-center rounded-full bg-muted/60 ring-1 ring-border/40 px-2.5 py-0.5 text-[11px] font-medium ap-tag-pop"
          style={{ animationDelay: `${idx * 25}ms` }}
        >
          {v}
        </span>
      ))}
      {copyAll && (
        <CopyButton
          value={values.join(", ")}
          label={label.toLowerCase()}
          size="xs"
        />
      )}
    </div>
  );
}

interface SwapSuggestion {
  tag: string;
  reason: string;
  totalListings: number;
  avgTopFavorites: number;
  tier: TagTier;
}

function TagsRow({
  tags,
  intelligence,
  productTitle,
  productType,
  category,
  onSwap,
}: {
  tags: string[];
  intelligence: TagDemand[];
  productTitle: string;
  productType: string;
  category: string;
  onSwap: (oldTag: string, newSuggestion: SwapSuggestion) => void;
}) {
  const intelByTag = new Map(intelligence.map((i) => [i.tag, i]));

  async function copyAll() {
    await navigator.clipboard.writeText(tags.join(", "));
    toast.success(`Copied all ${tags.length} tags`);
  }

  return (
    <div className="py-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          Tags
          <span className="ml-1.5 text-muted-foreground/60 font-medium normal-case tracking-normal">
            · {tags.length}/13 · tap to copy · ↻ to swap
          </span>
        </p>
        <button
          type="button"
          onClick={copyAll}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold border border-border hover:bg-muted/60 text-foreground/80 transition-colors"
        >
          <Copy className="size-3" /> Copy all
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, idx) => {
          const intel = intelByTag.get(tag);
          return (
            <div
              key={`${tag}-${idx}-${tag.length}`}
              className="ap-tag-pop"
              style={{ animationDelay: `${idx * 35}ms` }}
            >
              <TagPillWithSwap
                tag={tag}
                intel={intel}
                productTitle={productTitle}
                productType={productType}
                category={category}
                existingTags={tags}
                onSwap={(suggestion) => onSwap(tag, suggestion)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TagPillWithSwap({
  tag,
  intel,
  productTitle,
  productType,
  category,
  existingTags,
  onSwap,
}: {
  tag: string;
  intel?: TagDemand;
  productTitle: string;
  productType: string;
  category: string;
  existingTags: string[];
  onSwap: (suggestion: SwapSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SwapSuggestion[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const isLong = tag.length > TAG_MAX;

  async function handleCopy() {
    await navigator.clipboard.writeText(tag);
    setCopied(true);
    toast.success(`Copied "${tag}"`);
    setTimeout(() => setCopied(false), 1500);
  }

  async function fetchSuggestions() {
    setLoading(true);
    setFetchError(null);
    setSuggestions(null);
    try {
      const res = await fetch("/api/seo-autopilot/swap-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentTag: tag,
          productTitle,
          productType,
          category,
          existingTags,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function handlePickSuggestion(s: SwapSuggestion) {
    onSwap(s);
    setOpen(false);
    setSuggestions(null);
    setFetchError(null);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setSuggestions(null);
          setFetchError(null);
        }
      }}
    >
      <div
        className={`inline-flex items-center gap-1 rounded-full ring-1 transition-all hover:-translate-y-px ${
          isLong
            ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 ring-rose-300/50"
            : copied
              ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 ring-emerald-300/50"
              : "bg-card hover:bg-muted/40 text-foreground/85 ring-border/70"
        }`}
      >
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 pl-2.5 py-1 text-[11px] font-medium"
          title={
            intel
              ? `${tag} · ${formatCount(intel.totalListings)} listings · avg ${intel.avgTopFavorites} favs · tap to copy`
              : `Copy "${tag}"`
          }
        >
          {copied ? (
            <Check className="size-3 text-emerald-600" strokeWidth={3} />
          ) : (
            <Hash className="size-3 opacity-40" />
          )}
          <span>{tag}</span>
          {intel && (
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${TIER_STYLE[intel.tier]}`}
            >
              <span>{TIER_GLYPH[intel.tier]}</span>
              <span>{formatCount(intel.totalListings)}</span>
            </span>
          )}
        </button>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="size-6 rounded-full hover:bg-muted/60 text-muted-foreground hover:text-foreground flex items-center justify-center mr-0.5 transition-colors"
              title="Suggest replacement tags"
            />
          }
        >
          <Shuffle className="size-3" />
        </PopoverTrigger>
      </div>
      <PopoverContent align="start" className="w-80 p-3 space-y-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-1">
            Replace this tag
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">&ldquo;{tag}&rdquo;</span>
            {intel && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${TIER_STYLE[intel.tier]}`}
              >
                <span>{TIER_GLYPH[intel.tier]}</span>
                <span>{formatCount(intel.totalListings)}</span>
              </span>
            )}
          </div>
        </div>

        {!suggestions && !loading && !fetchError && (
          <Button
            type="button"
            onClick={fetchSuggestions}
            size="sm"
            className="w-full h-8 gap-1.5 text-xs"
          >
            <Shuffle className="size-3" />
            Suggest 3 alternatives
          </Button>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="size-3.5 animate-spin" />
            Finding better alternatives…
          </div>
        )}

        {fetchError && (
          <div className="text-xs text-rose-600 dark:text-rose-400 py-2">
            {fetchError}
            <button
              type="button"
              onClick={fetchSuggestions}
              className="ml-2 underline"
            >
              Retry
            </button>
          </div>
        )}

        {suggestions && suggestions.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">
            No good alternatives found — your current tag may already be the best fit.
          </p>
        )}

        {suggestions && suggestions.length > 0 && (
          <ul className="space-y-1.5">
            {suggestions.map((s, i) => (
              <li
                key={s.tag}
                className="ap-stagger-in"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <button
                  type="button"
                  onClick={() => handlePickSuggestion(s)}
                  className="w-full text-left rounded-lg border border-border/70 bg-card hover:bg-muted/40 hover:border-orange-500/40 px-3 py-2.5 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-sm font-semibold">{s.tag}</span>
                    <span
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${TIER_STYLE[s.tier]}`}
                    >
                      <span>{TIER_GLYPH[s.tier]}</span>
                      <span>{formatCount(s.totalListings)}</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {s.reason}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {suggestions && (
          <button
            type="button"
            onClick={fetchSuggestions}
            disabled={loading}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? "Regenerating…" : "Try 3 new ones"}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AltTextRow({
  altTexts,
  images,
}: {
  altTexts: string[];
  images: UploadedImage[];
}) {
  // CEO directive May 19 2026: ONE general alt text for the whole
  // listing, not one per image. The seller pastes the same string
  // into every image slot on Etsy. UI renders a single card now,
  // with a strip of image thumbnails on the left as a reminder that
  // the same alt covers every photo.
  const alt = altTexts[0]?.trim() ?? "";
  if (!alt) return null;
  const thumbs = images.slice(0, 4);

  return (
    <div className="py-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          Image alt text
        </p>
        <p className="text-[10px] text-muted-foreground/70">
          one general alt — paste on every image
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/15 px-3.5 py-3 flex gap-3 items-start">
        {thumbs.length > 0 ? (
          <div className="flex -space-x-2 shrink-0">
            {thumbs.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img.previewUrl}
                alt=""
                className="size-14 rounded-lg object-cover ring-2 ring-card shadow-sm"
              />
            ))}
            {images.length > thumbs.length && (
              <div className="size-14 rounded-lg bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground ring-2 ring-card shadow-sm">
                +{images.length - thumbs.length}
              </div>
            )}
          </div>
        ) : (
          <div className="size-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <ImageIcon className="size-4 text-muted-foreground/40" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[9px] font-bold text-muted-foreground/80 uppercase tracking-[0.18em]">
              {images.length > 0 ? `Use on all ${images.length} image${images.length === 1 ? "" : "s"}` : "Listing alt text"}
            </p>
            <CopyButton value={alt} label="alt text" size="xs" />
          </div>
          <p className="text-[12px] text-foreground/90 leading-relaxed italic">
            &ldquo;{alt}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Insights panel (tabbed, sidebar-style) ────────────────────────
//
// Redesigned as a 4-tab analytics panel — Health · Keywords · Tags ·
// Competition — modeled on tools like eRank's keyword analyzer. Tabs
// are always visible (no collapse) so employees can scan results +
// scroll insights at the same time on desktop (where it docks as a
// sticky right sidebar).

type InsightsTab = "health" | "keywords" | "tags" | "competition";

function InsightsDrawer({ data }: { data: GenerateResponse }) {
  const [tab, setTab] = useState<InsightsTab>("health");
  const tagIntel = data.tagIntelligence ?? [];
  const anchors = data.anchorKeywords;
  const hasAnchors =
    !!anchors && (anchors.topPhrases.length > 0 || anchors.topTags.length > 0);
  const hasCompetitors = data.research.topCompetitors.length > 0;
  const hasInsights =
    tagIntel.length > 0 ||
    hasCompetitors ||
    data.listing?.rationale.keywordFocus ||
    hasAnchors;

  if (!hasInsights) return null;

  return (
    <PremiumCard>
      {/* HEADER */}
      <div className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-16 -right-10 size-[280px] rounded-full blur-3xl opacity-40 ap-aurora-3"
          style={{
            background:
              "radial-gradient(closest-side, rgba(16,185,129,0.4), transparent 70%)",
          }}
        />
        <div className="relative p-5 sm:p-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <span
                aria-hidden
                className="absolute -inset-1 rounded-2xl bg-emerald-400/30 blur-md"
              />
              <div className="relative size-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-sky-600 ring-1 ring-emerald-700/30 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                <Activity className="size-5 text-white" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.22em]">
                Insights
              </p>
              <h3 className="text-base font-bold tracking-tight leading-tight">
                Why this listing should rank
              </h3>
            </div>
          </div>
        </div>
      </div>

      {/* TAB BAR */}
      <div className="px-3 border-y border-border/60 bg-muted/15">
        <div className="flex items-center gap-0.5 overflow-x-auto -mx-1 px-1 scrollbar-thin">
          <InsightsTabPill
            active={tab === "health"}
            onClick={() => setTab("health")}
            label="Health"
          />
          <InsightsTabPill
            active={tab === "keywords"}
            onClick={() => setTab("keywords")}
            label="Keywords"
            disabled={!hasAnchors}
          />
          <InsightsTabPill
            active={tab === "tags"}
            onClick={() => setTab("tags")}
            label="Tags"
            disabled={tagIntel.length === 0}
            badge={tagIntel.length || undefined}
          />
          <InsightsTabPill
            active={tab === "competition"}
            onClick={() => setTab("competition")}
            label="Competition"
            disabled={!hasCompetitors}
            badge={data.research.topCompetitors.length || undefined}
          />
        </div>
      </div>

      {/* TAB CONTENT */}
      <div className="p-5 sm:p-6 min-h-[300px]">
        {tab === "health" && <HealthTab data={data} onChangeTab={setTab} />}
        {tab === "keywords" && hasAnchors && anchors && (
          <KeywordsTab anchors={anchors} listing={data.listing} />
        )}
        {tab === "tags" && tagIntel.length > 0 && (
          <TagsTab intel={tagIntel} />
        )}
        {tab === "competition" && hasCompetitors && (
          <CompetitionTab
            competitors={data.research.topCompetitors}
            competitorsAnalyzed={data.research.competitorsAnalyzed}
            searchKeyword={data.research.searchKeyword}
          />
        )}
      </div>
    </PremiumCard>
  );
}

// ─── Tab bar pill ──────────────────────────────────────────────────
//
// Compact pill — no leading icon, tight padding — designed to fit all
// four labels ("Health · Keywords · Tags · Competition") in the narrow
// 40%-width sidebar on lg+. Active tab gets a gradient underline.

function InsightsTabPill({
  active,
  onClick,
  label,
  badge,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex items-center gap-1 px-2 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {typeof badge === "number" && (
        <span
          className={`inline-flex items-center justify-center rounded-full text-[9px] font-bold tabular-nums size-4 ${
            active
              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {badge}
        </span>
      )}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-t-full bg-gradient-to-r from-emerald-500 to-sky-500"
        />
      )}
    </button>
  );
}

// ─── Health score calculation ──────────────────────────────────────

interface HealthScore {
  total: number; // 0-100
  grade: "A" | "B" | "C" | "D";
  subs: Array<{
    label: string;
    score: number; // 0-100
    detail: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
  issues: Array<{
    severity: "warn" | "info";
    text: string;
    action?: { label: string; targetTab: InsightsTab };
  }>;
}

function calcHealthScore(data: GenerateResponse): HealthScore {
  const listing = data.listing;
  const tagIntel = data.tagIntelligence ?? [];
  const anchors = data.anchorKeywords;
  const issues: HealthScore["issues"] = [];

  // ─── Title score (out of 100) ────────────────────────────────────
  let titleScore = 0;
  if (listing) {
    const titleLen = listing.title.length;
    // Length utilization (up to 50 pts)
    if (titleLen >= 100 && titleLen <= 140) titleScore += 50;
    else if (titleLen >= 80) titleScore += 35;
    else if (titleLen >= 60) titleScore += 20;
    else titleScore += 10;
    // Pipe separators (up to 25 pts) — pros use 2+
    const pipeCount = (listing.title.match(/\|/g) || []).length;
    if (pipeCount >= 2) titleScore += 25;
    else if (pipeCount === 1) titleScore += 15;
    // No commas (good practice — Etsy splits at commas) — 25 pts
    if (!listing.title.includes(",")) titleScore += 25;

    if (titleLen < 100) {
      issues.push({
        severity: "info",
        text: `Title is ${titleLen}/140 chars — adding more keyword surface usually helps rank.`,
      });
    }
    if (listing.title.includes(",")) {
      issues.push({
        severity: "warn",
        text: "Title uses commas — Etsy treats commas as keyword separators. Use ` | ` instead.",
      });
    }
  }

  // ─── Tags score (out of 100) ────────────────────────────────────
  let tagsScore = 0;
  if (listing) {
    // Tag count (must be 13) — 20 pts
    if (listing.tags.length === 13) tagsScore += 20;
    // No duplicates — 20 pts
    const lower = listing.tags.map((t) => t.toLowerCase());
    if (new Set(lower).size === lower.length) tagsScore += 20;
    // Tier distribution — 60 pts: need niche presence for new shops
    if (tagIntel.length > 0) {
      const tiers = tagIntel.reduce(
        (acc, t) => {
          acc[t.tier] = (acc[t.tier] ?? 0) + 1;
          return acc;
        },
        {} as Record<TagTier, number>,
      );
      const niche = tiers.niche ?? 0;
      const moderate = tiers.moderate ?? 0;
      const hot = tiers.hot ?? 0;
      const saturated = tiers.saturated ?? 0;
      // Reward 2+ niche tags, 4+ moderate, 4-6 hot, 0-2 saturated
      if (niche >= 2) tagsScore += 25;
      else if (niche === 1) tagsScore += 12;
      else
        issues.push({
          severity: "warn",
          text: "No niche tags (under 1k listings) — a new shop won't rank against the established sellers without easier wins. Swap 1-2 hot tags for niche alternatives.",
          action: { label: "View tags", targetTab: "tags" },
        });

      if (moderate >= 3) tagsScore += 20;
      else if (moderate >= 1) tagsScore += 10;

      if (hot >= 3 && hot <= 7) tagsScore += 10;
      if (saturated === 0) tagsScore += 5;
      else if (saturated >= 3)
        issues.push({
          severity: "warn",
          text: `${saturated} tags are saturated (>50k listings) — these almost never rank for new shops. Consider swapping at least one.`,
          action: { label: "View tags", targetTab: "tags" },
        });
    } else {
      // No intel — give partial credit
      tagsScore += 30;
    }
  }

  // ─── Description score (out of 100) ─────────────────────────────
  let descScore = 0;
  if (listing) {
    const len = listing.description.length;
    // Length (up to 50 pts) — target 600-1500 chars
    if (len >= 600 && len <= 1500) descScore += 50;
    else if (len >= 400) descScore += 35;
    else if (len >= 200) descScore += 20;
    else descScore += 5;
    // Has bullets (up to 30 pts)
    const bulletCount = (listing.description.match(/•/g) || []).length;
    if (bulletCount >= 4) descScore += 30;
    else if (bulletCount >= 2) descScore += 15;
    // Sections (blank lines = 20 pts)
    const sectionCount = listing.description.split(/\n\s*\n/).length;
    if (sectionCount >= 3) descScore += 20;
    else if (sectionCount === 2) descScore += 10;
  }

  // ─── Keyword anchor coverage (out of 100) ───────────────────────
  let kwScore = 0;
  if (listing && anchors) {
    const titleLower = listing.title.toLowerCase();
    const tagsLower = new Set(listing.tags.map((t) => t.toLowerCase()));
    const totalPhrases = anchors.topPhrases.length;
    let hit = 0;
    for (const p of anchors.topPhrases) {
      if (
        titleLower.includes(p.phrase.toLowerCase()) ||
        tagsLower.has(p.phrase.toLowerCase())
      ) {
        hit += 1;
      }
    }
    if (totalPhrases === 0) kwScore = 70;
    else kwScore = Math.round((hit / totalPhrases) * 100);
    if (totalPhrases > 0 && hit / totalPhrases < 0.4) {
      issues.push({
        severity: "warn",
        text: `Only ${hit}/${totalPhrases} top anchor phrases appear in your title or tags. Anchor keywords are the proven buyer-search terms from the top 20 ranking listings — front-load them.`,
        action: { label: "View keywords", targetTab: "keywords" },
      });
    }
  } else {
    kwScore = 70;
  }

  const total = Math.round((titleScore + tagsScore + descScore + kwScore) / 4);
  const grade: HealthScore["grade"] =
    total >= 90 ? "A" : total >= 75 ? "B" : total >= 60 ? "C" : "D";

  return {
    total,
    grade,
    subs: [
      {
        label: "Title",
        score: titleScore,
        detail: listing
          ? `${listing.title.length}/140 chars · ${
              (listing.title.match(/\|/g) || []).length
            } separators`
          : "—",
        icon: Type,
      },
      {
        label: "Tags",
        score: tagsScore,
        detail: listing
          ? `${listing.tags.length}/13 · ${tagIntel.length} scored`
          : "—",
        icon: Hash,
      },
      {
        label: "Description",
        score: descScore,
        detail: listing ? `${listing.description.length} chars` : "—",
        icon: Type,
      },
      {
        label: "Anchor coverage",
        score: kwScore,
        detail:
          anchors && anchors.topPhrases.length > 0
            ? `${anchors.topPhrases.length} anchors analyzed`
            : "limited data",
        icon: Target,
      },
    ],
    issues,
  };
}

// ─── Health tab ────────────────────────────────────────────────────

function HealthTab({
  data,
  onChangeTab,
}: {
  data: GenerateResponse;
  onChangeTab: (t: InsightsTab) => void;
}) {
  const health = calcHealthScore(data);
  const ringTone =
    health.total >= 90
      ? "emerald"
      : health.total >= 75
        ? "sky"
        : health.total >= 60
          ? "amber"
          : "rose";
  const ringClass = {
    emerald: "from-emerald-500 to-emerald-600 shadow-emerald-500/40",
    sky: "from-sky-500 to-sky-600 shadow-sky-500/40",
    amber: "from-amber-500 to-orange-500 shadow-amber-500/40",
    rose: "from-rose-500 to-rose-600 shadow-rose-500/40",
  }[ringTone];

  return (
    <div className="space-y-5">
      {/* Score + grade */}
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <span
            aria-hidden
            className={`absolute -inset-1 rounded-full bg-gradient-to-br ${ringClass} blur-md opacity-50`}
          />
          <div
            className={`relative size-20 rounded-full bg-gradient-to-br ${ringClass} ring-2 ring-white/30 flex flex-col items-center justify-center shadow-xl text-white`}
          >
            <span className="text-2xl font-bold tabular-nums leading-none">
              {health.total}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">
              /100
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Listing health
          </p>
          <p className="text-xl font-bold leading-tight">
            Grade {health.grade}
            <span className="text-muted-foreground/60 font-medium ml-1.5 text-sm">
              ·{" "}
              {health.total >= 90
                ? "Excellent"
                : health.total >= 75
                  ? "Strong"
                  : health.total >= 60
                    ? "Decent"
                    : "Needs work"}
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            Composite of title quality, tag mix, description, and how well
            you front-load proven anchor keywords from winning listings.
          </p>
        </div>
      </div>

      {/* Sub-scores */}
      <div className="grid grid-cols-2 gap-2">
        {health.subs.map((s) => (
          <HealthSubCell key={s.label} sub={s} />
        ))}
      </div>

      {/* Issues / suggestions */}
      {health.issues.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
            <Lightbulb className="size-3" />
            {health.issues.length} suggestion
            {health.issues.length > 1 ? "s" : ""} to improve
          </p>
          <div className="space-y-1.5">
            {health.issues.map((issue, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2.5 text-[11px] leading-relaxed ring-1 ${
                  issue.severity === "warn"
                    ? "bg-amber-50/60 dark:bg-amber-950/20 ring-amber-500/25"
                    : "bg-sky-50/60 dark:bg-sky-950/20 ring-sky-500/25"
                }`}
              >
                <div className="flex items-start gap-2">
                  {issue.severity === "warn" ? (
                    <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  ) : (
                    <Info className="size-3 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p>{issue.text}</p>
                    {issue.action && (
                      <button
                        type="button"
                        onClick={() => onChangeTab(issue.action!.targetTab)}
                        className="mt-1 text-[10px] font-bold uppercase tracking-wider underline opacity-80 hover:opacity-100"
                      >
                        {issue.action.label} →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Why this works — collapsed rationale */}
      {data.listing?.rationale.keywordFocus && (
        <div className="border-t border-border/40 pt-4 space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
            <Sparkle className="size-3" />
            Autopilot&apos;s strategy
          </p>
          <RationaleCompactBlock rationale={data.listing.rationale} />
        </div>
      )}
    </div>
  );
}

function HealthSubCell({
  sub,
}: {
  sub: HealthScore["subs"][number];
}) {
  const Icon = sub.icon;
  const tone =
    sub.score >= 80
      ? "emerald"
      : sub.score >= 60
        ? "sky"
        : sub.score >= 40
          ? "amber"
          : "rose";
  const toneClass = {
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  }[tone];
  const textTone = {
    emerald: "text-emerald-700 dark:text-emerald-400",
    sky: "text-sky-700 dark:text-sky-400",
    amber: "text-amber-700 dark:text-amber-400",
    rose: "text-rose-700 dark:text-rose-400",
  }[tone];
  return (
    <div className="rounded-lg bg-muted/20 ring-1 ring-border/50 px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="size-3 text-muted-foreground/70 shrink-0" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">
            {sub.label}
          </p>
        </div>
        <span className={`text-xs font-bold tabular-nums ${textTone}`}>
          {sub.score}
        </span>
      </div>
      <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
        <div
          className={`h-full ap-bar-fill ${toneClass}`}
          style={{ ["--bar-w" as string]: `${sub.score}%` }}
        />
      </div>
      <p className="text-[9px] text-muted-foreground/70 mt-1 truncate">
        {sub.detail}
      </p>
    </div>
  );
}

function RationaleCompactBlock({
  rationale,
}: {
  rationale: GeneratedListing["rationale"];
}) {
  const rows = [
    { label: "Keyword focus", value: rationale.keywordFocus, icon: Hash },
    { label: "Title strategy", value: rationale.titleStrategy, icon: Type },
    { label: "Audience hook", value: rationale.audienceHook, icon: Heart },
  ].filter((r) => r.value);
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const Icon = r.icon;
        return (
          <div
            key={r.label}
            className="rounded-md bg-muted/20 ring-1 ring-border/40 px-3 py-2 flex items-start gap-2.5 ap-stagger-in"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <Icon className="size-3 text-muted-foreground/60 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">
                {r.label}
              </p>
              <p className="text-[11px] text-foreground/85 leading-relaxed mt-0.5">
                {r.value}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Keywords tab ──────────────────────────────────────────────────

function KeywordsTab({
  anchors,
  listing,
}: {
  anchors: AnchorKeywords;
  listing: GeneratedListing | null;
}) {
  const titleLower = (listing?.title ?? "").toLowerCase();
  const tagsLower = new Set(
    (listing?.tags ?? []).map((t) => t.toLowerCase()),
  );

  const annotatePhrase = (phrase: string) => {
    const lower = phrase.toLowerCase();
    return {
      inTitle: titleLower.includes(lower),
      inTags: tagsLower.has(lower),
    };
  };

  return (
    <div className="space-y-5">
      {/* Explainer */}
      <div className="rounded-lg bg-emerald-50/40 dark:bg-emerald-950/20 ring-1 ring-emerald-500/20 px-3 py-2.5 flex items-start gap-2.5">
        <Info className="size-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
        <p className="text-[11px] leading-relaxed text-foreground/85">
          <strong>Anchor keywords</strong> are the phrases that appear most
          often in the top-{anchors.totalListings} ranking listings for your
          search. They&apos;re proven buyer-search terms — Autopilot
          front-loads them in your title to mirror what&apos;s already winning.
        </p>
      </div>

      {/* Top phrases */}
      {anchors.topPhrases.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Top phrases (from titles)
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              ✓ = appears in your listing
            </p>
          </div>
          <div className="space-y-1.5">
            {anchors.topPhrases.map((p) => {
              const { inTitle, inTags } = annotatePhrase(p.phrase);
              const used = inTitle || inTags;
              return (
                <div
                  key={p.phrase}
                  className={`rounded-lg ring-1 px-3 py-2 flex items-center gap-2 ${
                    used
                      ? "bg-emerald-50/40 dark:bg-emerald-950/15 ring-emerald-500/25"
                      : "bg-muted/15 ring-border/50"
                  }`}
                >
                  {used ? (
                    <Check
                      className="size-3 text-emerald-600 dark:text-emerald-400 shrink-0"
                      strokeWidth={3}
                    />
                  ) : (
                    <span className="size-3 rounded-full bg-muted-foreground/20 shrink-0" />
                  )}
                  <span className="text-[12px] font-medium flex-1 min-w-0 truncate">
                    {p.phrase}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {inTitle && (
                      <span className="text-[9px] font-bold uppercase tracking-wider bg-orange-500/15 ring-1 ring-orange-500/30 text-orange-700 dark:text-orange-300 rounded px-1.5 py-0.5">
                        Title
                      </span>
                    )}
                    {inTags && (
                      <span className="text-[9px] font-bold uppercase tracking-wider bg-violet-500/15 ring-1 ring-violet-500/30 text-violet-700 dark:text-violet-300 rounded px-1.5 py-0.5">
                        Tag
                      </span>
                    )}
                    <span className="text-[10px] font-bold tabular-nums text-muted-foreground w-9 text-right">
                      {p.percentage}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top tags from competitors */}
      {anchors.topTags.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Top tags used by competitors
          </p>
          <div className="flex flex-wrap gap-1.5">
            {anchors.topTags.map((t) => {
              const { inTags } = annotatePhrase(t.phrase);
              return (
                <span
                  key={t.phrase}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ring-1 ${
                    inTags
                      ? "bg-emerald-500/15 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted/40 ring-border"
                  }`}
                  title={`Used by ${t.count} of ${anchors.totalListings} top listings`}
                >
                  {inTags && (
                    <Check
                      className="size-2.5 text-emerald-600 dark:text-emerald-400"
                      strokeWidth={3}
                    />
                  )}
                  <span className="font-medium">{t.phrase}</span>
                  <span className="text-[9px] font-bold tabular-nums opacity-70">
                    {t.percentage}%
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Education box */}
      <div className="border-t border-border/40 pt-4 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
          <Lightbulb className="size-3" />
          Why this matters
        </p>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-foreground/80">
          <li className="flex gap-2">
            <span className="mt-1 size-1 rounded-full bg-emerald-500 shrink-0" />
            <span>
              Etsy&apos;s algorithm weighs the <strong>first 40 chars</strong>{" "}
              of your title heaviest — anchor phrases there beat the same
              phrase buried at the end.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 size-1 rounded-full bg-sky-500 shrink-0" />
            <span>
              <strong>Long-tail beats short-tail</strong> for new shops — 3-5
              word phrases rank way easier than &ldquo;dress&rdquo; alone.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 size-1 rounded-full bg-violet-500 shrink-0" />
            <span>
              If a phrase shows up in 80%+ of top listings, skipping it is
              leaving free ranking signal on the floor.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ─── Tags tab ──────────────────────────────────────────────────────

function TagsTab({ intel }: { intel: TagDemand[] }) {
  const counts = intel.reduce(
    (acc, t) => {
      acc[t.tier] = (acc[t.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<TagTier, number>,
  );
  const total = intel.length;

  return (
    <div className="space-y-5">
      {/* Tier explainer */}
      <div className="space-y-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Tag mix by competition tier
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {(["niche", "moderate", "hot", "saturated"] as TagTier[]).map((t) => {
            const count = counts[t] ?? 0;
            return (
              <div
                key={t}
                className={`rounded-lg ring-1 px-2.5 py-2 ${TIER_STYLE[t]}`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <span>{TIER_GLYPH[t]}</span>
                    {t}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {count}
                  </span>
                </div>
                <p className="text-[9px] opacity-75 leading-tight">
                  {TIER_DESCRIPTION[t]}
                </p>
              </div>
            );
          })}
        </div>
        {(counts.niche ?? 0) === 0 && total >= 5 && (
          <div className="rounded-lg bg-amber-50/60 dark:bg-amber-950/20 ring-1 ring-amber-500/25 px-3 py-2 text-[11px] flex items-start gap-2">
            <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <span className="leading-relaxed">
              <strong>No niche tags.</strong> New shops need at least 1-2 tags
              under 1k listings to rank in week one. Click ↻ on a hot tag in
              the result and Autopilot will suggest niche alternatives.
            </span>
          </div>
        )}
      </div>

      {/* Per-tag table */}
      <TagIntelligenceBlock intel={intel} />
    </div>
  );
}

// ─── Competition tab ───────────────────────────────────────────────

function CompetitionTab({
  competitors,
  competitorsAnalyzed,
  searchKeyword,
}: {
  competitors: { rank: number; title: string; favorites: number }[];
  competitorsAnalyzed: number;
  searchKeyword: string;
}) {
  const avgFavs =
    competitors.length > 0
      ? Math.round(
          competitors.reduce((s, c) => s + c.favorites, 0) / competitors.length,
        )
      : 0;
  const maxFavs = competitors.length > 0
    ? Math.max(...competitors.map((c) => c.favorites))
    : 0;

  return (
    <div className="space-y-5">
      {/* Niche overview */}
      <div className="grid grid-cols-3 gap-2">
        <CompetitionStat
          label="Analyzed"
          value={competitorsAnalyzed.toString()}
          subtitle="top listings"
        />
        <CompetitionStat
          label="Avg favs"
          value={formatCount(avgFavs)}
          subtitle="benchmark"
        />
        <CompetitionStat
          label="Top spot"
          value={formatCount(maxFavs)}
          subtitle="#1 favs"
        />
      </div>

      <div className="rounded-lg bg-sky-50/40 dark:bg-sky-950/20 ring-1 ring-sky-500/20 px-3 py-2.5 flex items-start gap-2.5">
        <Info className="size-3.5 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" />
        <p className="text-[11px] leading-relaxed text-foreground/85">
          These are the <strong>top {competitors.length} listings</strong>{" "}
          ranking for{" "}
          <span className="font-bold text-foreground">
            &ldquo;{searchKeyword}&rdquo;
          </span>{" "}
          today. To beat them, you need to match their keyword coverage AND
          earn enough favorites to climb. Autopilot front-loaded the proven
          keywords; favorites grow from listing photos + reviews.
        </p>
      </div>

      <CompetitorsBlock competitors={competitors} />
    </div>
  );
}

function CompetitionStat({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-lg bg-muted/20 ring-1 ring-border/50 px-2.5 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-base font-bold tabular-nums leading-tight mt-0.5">
        {value}
      </p>
      <p className="text-[9px] text-muted-foreground/70 mt-0.5">{subtitle}</p>
    </div>
  );
}

function InsightsSectionHeader({
  icon: Icon,
  label,
  description,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  tone: "emerald" | "amber" | "violet" | "sky";
}) {
  const toneClass = {
    emerald:
      "bg-emerald-500/15 ring-emerald-500/30 text-emerald-600 dark:text-emerald-400",
    amber:
      "bg-amber-500/15 ring-amber-500/30 text-amber-600 dark:text-amber-400",
    violet:
      "bg-violet-500/15 ring-violet-500/30 text-violet-600 dark:text-violet-400",
    sky: "bg-sky-500/15 ring-sky-500/30 text-sky-600 dark:text-sky-400",
  } as const;
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`size-7 rounded-lg ring-1 flex items-center justify-center shrink-0 ${toneClass[tone]}`}
      >
        <Icon className="size-3.5" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground/75 leading-snug">
          {description}
        </p>
      </div>
    </div>
  );
}

function TagIntelligenceBlock({ intel }: { intel: TagDemand[] }) {
  const [sortBy, setSortBy] = useState<"score" | "listings" | "tag">("score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  function toggle(col: typeof sortBy) {
    if (sortBy === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setDir(col === "tag" ? "asc" : "desc");
    }
  }

  const sorted = [...intel].sort((a, b) => {
    const m = dir === "asc" ? 1 : -1;
    if (sortBy === "tag") return a.tag.localeCompare(b.tag) * m;
    if (sortBy === "listings") return (a.totalListings - b.totalListings) * m;
    return (a.demandScore - b.demandScore) * m;
  });

  const counts = intel.reduce(
    (acc, t) => {
      acc[t.tier] = (acc[t.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<TagTier, number>,
  );

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <InsightsSectionHeader
          icon={Zap}
          label="Tag intelligence — live Etsy demand"
          description="Listings per tag = live demand signal. Listings + top-favs combined give demand score."
          tone="amber"
        />
        <div className="flex items-center gap-1">
          {(["niche", "moderate", "hot", "saturated"] as TagTier[]).map((t) =>
            counts[t] ? (
              <span
                key={t}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ring-1 ${TIER_STYLE[t]}`}
                title={TIER_DESCRIPTION[t]}
              >
                <span>{TIER_GLYPH[t]}</span>
                <span>{counts[t]}</span>
              </span>
            ) : null,
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <tr>
              <Th
                label="Tag"
                active={sortBy === "tag"}
                dir={dir}
                onClick={() => toggle("tag")}
              />
              <Th
                label="Listings"
                active={sortBy === "listings"}
                dir={dir}
                onClick={() => toggle("listings")}
                align="right"
              />
              <Th
                label="Top favs"
                active={false}
                dir={dir}
                onClick={() => {}}
                align="right"
                disabled
              />
              <Th
                label="Demand"
                active={sortBy === "score"}
                dir={dir}
                onClick={() => toggle("score")}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={r.tag}
                className="border-t border-border/40 hover:bg-muted/15 transition-colors ap-stagger-in"
                style={{ animationDelay: `${i * 25}ms` }}
              >
                <td className="px-3 py-2.5 font-semibold">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-5 rounded-full flex items-center justify-center text-[10px] ring-1 ${TIER_STYLE[r.tier]}`}
                    >
                      {TIER_GLYPH[r.tier]}
                    </span>
                    <span>{r.tag}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.error ? "—" : formatCount(r.totalListings)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {r.error ? "—" : r.avgTopFavorites.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <DemandBar score={r.demandScore} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        Etsy doesn&apos;t share real search volume. These are live counts from{" "}
        <code className="rounded bg-muted/60 px-1 py-0.5 text-[10px]">
          /listings/active
        </code>{" "}
        for each tag — a strong proxy for demand and competition.
      </p>
    </div>
  );
}

function Th({
  label,
  active,
  dir,
  onClick,
  align,
  disabled,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2.5 font-bold ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1 transition-colors ${
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        } disabled:hover:text-muted-foreground disabled:cursor-default`}
      >
        {label}
        {active && (
          <ChevronDown
            className={`size-3 transition-transform ${dir === "asc" ? "rotate-180" : ""}`}
          />
        )}
      </button>
    </th>
  );
}

function DemandBar({ score }: { score: number }) {
  const tone =
    score >= 75
      ? ("rose" as const)
      : score >= 50
        ? ("amber" as const)
        : score >= 25
          ? ("emerald" as const)
          : ("sky" as const);
  const toneClass = {
    rose: "bg-rose-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
  } as const;
  return (
    <div className="inline-flex items-center gap-2">
      <div className="w-14 h-1.5 rounded-full bg-muted/70 overflow-hidden">
        <div
          className={`h-full ap-bar-fill ${toneClass[tone]}`}
          style={{ ["--bar-w" as string]: `${Math.min(100, score)}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums font-bold w-7 text-right">
        {score}
      </span>
    </div>
  );
}

function CompetitorsBlock({
  competitors,
}: {
  competitors: { rank: number; title: string; favorites: number }[];
}) {
  const rankTone = (rank: number) => {
    if (rank === 1)
      return {
        bg: "bg-gradient-to-br from-amber-300 to-amber-500",
        ring: "ring-amber-600/30",
        text: "text-white",
        showCrown: true,
      };
    if (rank === 2)
      return {
        bg: "bg-gradient-to-br from-zinc-300 to-zinc-500",
        ring: "ring-zinc-600/30",
        text: "text-white",
        showCrown: false,
      };
    if (rank === 3)
      return {
        bg: "bg-gradient-to-br from-orange-300 to-orange-500",
        ring: "ring-orange-600/30",
        text: "text-white",
        showCrown: false,
      };
    return {
      bg: "bg-muted/60",
      ring: "ring-border",
      text: "text-foreground/70",
      showCrown: false,
    };
  };

  return (
    <div className="space-y-3">
      <InsightsSectionHeader
        icon={Award}
        label="Top 5 competitors Autopilot read"
        description="Live snapshot of the highest-ranking listings for this keyword."
        tone="sky"
      />
      <ul className="space-y-2">
        {competitors.map((c, i) => {
          const t = rankTone(c.rank);
          return (
            <li
              key={c.rank}
              className="rounded-xl border border-border/60 bg-card hover:bg-muted/20 transition-colors px-3.5 py-3 flex items-start gap-3 ap-stagger-in"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div
                className={`size-10 rounded-xl ring-1 flex items-center justify-center shrink-0 shadow-sm ${t.bg} ${t.ring}`}
              >
                {t.showCrown ? (
                  <Crown className={`size-4 ${t.text}`} />
                ) : (
                  <span
                    className={`text-[12px] font-bold tabular-nums ${t.text}`}
                  >
                    #{c.rank}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-foreground/90 leading-snug line-clamp-2">
                  {c.title}
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                    <Heart
                      className="size-3 text-rose-500"
                      fill="currentColor"
                    />
                    <span className="tabular-nums">
                      {c.favorites.toLocaleString()}
                    </span>
                    <span className="font-medium">favorites</span>
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── My recent generations (per-user history, last 30 days) ────────

/**
 * "Your recent generations" — shown to every user (not just CEO) on
 * the tool page when there's no active gen + no result displayed.
 * Lets them browse the last 30 days of their own gens and either
 * inline-expand to see the full listing or one-click "Restore" to load
 * the listing back into the result panel for fresh copy-paste.
 *
 * History is fetched once on mount + after each successful gen (so the
 * newest gen shows up at the top immediately).
 */
function MyHistorySection({
  entries,
  windowLabel,
  onRestore,
  isCeo,
}: {
  entries: MyHistoryEntry[];
  windowLabel: string;
  onRestore: (entry: MyHistoryEntry) => void;
  isCeo: boolean;
}) {
  // Default OPEN — the user complained they couldn't find their past
  // generations. Expanding by default makes them immediately visible
  // when the page loads with the input view (no result on screen).
  const [open, setOpen] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalCost = entries.reduce((s, e) => s + e.costUsd, 0);

  return (
    <PremiumCard>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left transition-colors hover:bg-muted/20"
      >
        <div className="p-6 sm:p-7 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0 ring-1 ring-border/60">
              <Clock className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em]">
                Generation history
              </p>
              <h3 className="text-[15px] font-semibold tracking-tight leading-tight mt-0.5">
                {windowLabel || "This month"} · {entries.length}{" "}
                {entries.length === 1 ? "listing" : "listings"}
              </h3>
              {/* Cost subtitle is CEO-only — employees don't see what
                  their gens cost, only that they exist. */}
              {isCeo && (
                <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                  AI spend: {formatHistoryCost(totalCost)}
                </p>
              )}
            </div>
          </div>
          <ChevronDown
            className={`size-5 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="px-6 sm:px-7 pb-7 border-t border-border/60 pt-5 space-y-2">
          {entries.map((entry, i) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggleExpand={() =>
                setExpandedId(expandedId === entry.id ? null : entry.id)
              }
              onRestore={() => onRestore(entry)}
              animationDelay={i * 30}
              showCost={isCeo}
            />
          ))}

          <p className="mt-4 pt-3 border-t border-border/40 text-[10px] text-muted-foreground/70 leading-snug">
            Showing this calendar month. List resets on the 1st. Use{" "}
            <strong>Restore</strong> to reload a past listing without using a new generation.
          </p>
        </div>
      )}
    </PremiumCard>
  );
}

function HistoryRow({
  entry,
  expanded,
  onToggleExpand,
  onRestore,
  animationDelay,
  showCost,
}: {
  entry: MyHistoryEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  onRestore: () => void;
  animationDelay: number;
  showCost: boolean;
}) {
  const verdictTone =
    entry.verdict === "BLOCKED"
      ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30"
      : entry.verdict === "REVIEW"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30";
  const hasListing = !!entry.listing;

  return (
    <div
      className="rounded-xl border border-border/60 bg-card hover:bg-muted/15 transition-colors ap-stagger-in overflow-hidden"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Verdict square */}
          <div
            className={`size-9 rounded-lg ring-1 flex items-center justify-center shrink-0 ${verdictTone}`}
          >
            {entry.verdict === "BLOCKED" ? (
              <Ban className="size-4" />
            ) : entry.verdict === "REVIEW" ? (
              <AlertTriangle className="size-4" />
            ) : (
              <Check className="size-4" strokeWidth={3} />
            )}
          </div>

          {/* Main info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <p
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    entry.verdict === "BLOCKED"
                      ? "text-rose-700 dark:text-rose-300"
                      : entry.verdict === "REVIEW"
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {entry.verdict}
                </p>
                <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                  ·{" "}
                  {new Intl.DateTimeFormat("en-PK", {
                    timeZone: "Asia/Karachi",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  }).format(new Date(entry.createdAt))}
                </span>
                {showCost && (
                  <span className="text-[10px] font-bold tabular-nums text-violet-700 dark:text-violet-300">
                    · {formatHistoryCost(entry.costUsd)}
                  </span>
                )}
              </div>
            </div>
            {entry.generatedTitle ? (
              <p className="text-[13px] font-semibold leading-snug mt-1 line-clamp-1">
                {entry.generatedTitle}
              </p>
            ) : (
              <p className="text-[13px] font-semibold leading-snug mt-1 line-clamp-1 italic text-muted-foreground">
                {entry.sourceTitle}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {entry.category ?? "—"}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {hasListing && (
              <>
                <button
                  type="button"
                  onClick={onToggleExpand}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 hover:border-orange-500/40 transition-colors"
                  title={expanded ? "Collapse details" : "Show full listing"}
                >
                  <ChevronDown
                    className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                  {expanded ? "Less" : "More"}
                </button>
                <button
                  type="button"
                  onClick={onRestore}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500 to-violet-600 text-white hover:opacity-90 transition-opacity"
                  title="Load this listing into the result panel"
                >
                  <RotateCw className="size-3" />
                  Restore
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expanded preview */}
      {expanded && entry.listing && (
        <div className="border-t border-border/60 bg-muted/10 px-4 py-3 space-y-3">
          <HistoryDetailBlock label="Title" value={entry.listing.title} />
          <HistoryDetailBlock
            label="Description"
            value={entry.listing.description}
            multiline
          />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
              Tags ({entry.listing.tags.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {entry.listing.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-card ring-1 ring-border/70 px-2 py-0.5 text-[10px] font-medium"
                >
                  <Hash className="size-2.5 opacity-40" />
                  {t}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(entry.listing!.tags.join(", "));
                toast.success("Copied all tags");
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <Copy className="size-2.5" />
              Copy all tags
            </button>
          </div>
          {entry.listing.altTexts[0]?.trim() && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
                Image alt text · one for every image
              </p>
              <p className="text-[11px] text-foreground/85 italic leading-snug rounded-md bg-card ring-1 ring-border/40 px-2.5 py-1.5">
                &ldquo;{entry.listing.altTexts[0]}&rdquo;
              </p>
            </div>
          )}
          {(entry.sizes.length > 0 || entry.variants.length > 0) && (
            <div className="flex gap-4 flex-wrap text-[11px]">
              {entry.sizes.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-0.5">
                    Sizes
                  </p>
                  <p>{entry.sizes.join(", ")}</p>
                </div>
              )}
              {entry.variants.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-0.5">
                    Variants
                  </p>
                  <p>{entry.variants.join(", ")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryDetailBlock({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(`Copied ${label.toLowerCase()}`);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <Check className="size-2.5 text-emerald-500" strokeWidth={3} />
          ) : (
            <Copy className="size-2.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p
        className={`text-[12px] leading-relaxed rounded-md bg-card ring-1 ring-border/40 px-2.5 py-1.5 ${
          multiline ? "whitespace-pre-wrap" : "truncate"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function formatHistoryCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function relativeFromNow(iso: string): string {
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

// ─── Restart button ─────────────────────────────────────────────────

function RestartButton({ onReset }: { onReset: () => void }) {
  return (
    <div className="pt-3 ap-stagger-in" style={{ animationDelay: "800ms" }}>
      <button
        type="button"
        onClick={onReset}
        className="group relative w-full overflow-hidden rounded-2xl border border-orange-500/25 hover:border-orange-500/60 bg-gradient-to-br from-orange-50/60 via-card to-violet-50/40 dark:from-orange-950/20 dark:via-card dark:to-violet-950/15 shadow-sm hover:shadow-lg hover:shadow-orange-500/15 transition-all h-16 px-5 flex items-center justify-center gap-4"
      >
        {/* Soft glow blob that pulses subtly on hover */}
        <span
          aria-hidden
          className="absolute -top-12 -left-10 size-32 rounded-full bg-orange-400/15 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"
        />
        <span
          aria-hidden
          className="absolute -bottom-12 -right-10 size-32 rounded-full bg-violet-400/15 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"
        />
        {/* Gradient icon chip */}
        <div className="relative shrink-0">
          <span
            aria-hidden
            className="absolute -inset-1 rounded-xl bg-gradient-to-br from-orange-400/40 to-violet-500/40 blur-md opacity-0 group-hover:opacity-100 transition-opacity"
          />
          <div className="relative size-10 rounded-xl bg-gradient-to-br from-[#F1641E] via-orange-500 to-violet-600 ring-1 ring-orange-700/30 flex items-center justify-center shadow-md shadow-orange-500/30 group-hover:scale-105 transition-transform">
            <Wand2 className="size-4 text-white" />
          </div>
        </div>
        {/* Label */}
        <div className="relative text-left min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-700/85 dark:text-orange-300/85">
            Generate another
          </p>
          <p className="text-[15px] font-bold tracking-tight leading-tight mt-0.5">
            Start a new listing
          </p>
        </div>
        {/* Chevron — slides on hover */}
        <RotateCw
          className="relative size-4 text-muted-foreground/60 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-all group-hover:rotate-180"
          aria-hidden
        />
      </button>
    </div>
  );
}


// ─── Copy button (shared) ───────────────────────────────────────────

function CopyButton({
  value,
  label,
  size = "sm",
}: {
  value: string;
  label: string;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(`Copied ${label}`);
    setTimeout(() => setCopied(false), 1800);
  }
  if (size === "xs") {
    return (
      <button
        onClick={handleCopy}
        type="button"
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        {copied ? (
          <Check className="size-3 text-emerald-500" strokeWidth={3} />
        ) : (
          <Copy className="size-3" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    );
  }
  return (
    <button
      onClick={handleCopy}
      type="button"
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-border/70 hover:bg-muted/60 hover:border-orange-500/40 text-foreground/80 transition-colors shrink-0"
    >
      {copied ? (
        <>
          <Check className="size-3 text-emerald-500" strokeWidth={3} /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3" /> Copy
        </>
      )}
    </button>
  );
}
