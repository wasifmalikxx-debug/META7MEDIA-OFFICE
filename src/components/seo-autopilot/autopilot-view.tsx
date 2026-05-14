"use client";

import { useState } from "react";
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
  TrendingUp,
  ImageIcon,
  Shuffle,
  Ruler,
  Palette,
  Type,
  Lightbulb,
  Crown,
} from "lucide-react";
import { toast } from "sonner";
import { SeoImageUploader, type UploadedImage } from "./image-uploader";
import { SizeSelector, VariantSelector } from "./option-selectors";

// ─── API response shape ─────────────────────────────────────────────

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
  materials: string[];
  attributes: { name: string; value: string }[];
  altTexts: string[];
  suggestedType: "physical" | "digital";
  suggestedWhenMade: string;
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
  attributesAvailable: number;
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
interface BuyerKeywordScore {
  keyword: string;
  totalListings: number;
  avgTopFavorites: number;
  tier: TagTier;
  buyerScore: number; // 0-100
}

interface GenerateResponse {
  compliance: ComplianceVerdict;
  listing: GeneratedListing | null;
  research: ResearchSummary;
  anchorKeywords?: AnchorKeywords;
  buyerKeywords?: BuyerKeywordScore[];
  tagIntelligence?: TagDemand[];
  inputs?: UserInputsEcho;
  generatedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────

const TITLE_MAX = 140;
const TAG_MAX = 20;

const TYPE_LABEL = {
  physical: "Physical item",
  digital: "Digital files",
} as const;

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

function whenMadeLabel(v: string): string {
  // All META7MEDIA products are ready-stock (regenerated AliExpress
  // dropship), so we surface the "2020_2026" Etsy code as "Ready to
  // ship". Sonnet should never suggest "made_to_order" anymore — but
  // if it slips through, we render it as Ready to ship too so the
  // employee never copies the wrong value into Etsy.
  if (v === "made_to_order" || v === "2020_2026") return "Ready to ship";
  if (v === "2010_2019") return "2010-2019";
  if (v === "2000_2009") return "2000-2009";
  return v;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ─── Main component ─────────────────────────────────────────────────

/**
 * SEO Autopilot — single-flow redesign (May 14 2026).
 *
 * Replaces the previous 4-section input + 9-section result with ONE
 * input card and ONE result card. Numbered steps in the input, clean
 * row-by-row fields in the result. Less colour, more typography. The
 * goal: an employee opens this and immediately knows what to do.
 *
 * Layout:
 *   - Brand header (one row)
 *   - Input card (steps 1, 2, optional 3 + CTA)
 *   - One of: progress / error / blocked / result + insights
 */
export function SeoAutopilotView() {
  // ─── Form state ───────────────────────────────────────────────────
  const [aliTitle, setAliTitle] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);

  // Variations — always visible (every product has sizes / variants).
  // Personalization, price, qty, SKU, who/what/when made, processing
  // time, returns policy AND notes were all removed in earlier passes.
  const [sizes, setSizes] = useState<string[]>([]);
  const [variants, setVariants] = useState<string[]>([]);

  // ─── Generation state ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "reading" | "checking" | "researching" | "writing" | "auditing"
  >("idle");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const titleValid = aliTitle.trim().length >= 8;
  const imagesValid = images.length >= 1;
  const canSubmit = titleValid && imagesValid && !generating;

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
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Generation failed (${res.status})`);
      }

      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStage("idle");

      if (data.compliance.verdict === "BLOCKED") {
        toast.error("Product blocked", { description: data.compliance.summary });
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
    setResult(null);
    setErrorMsg(null);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-12">
      <HeroBanner />

      {/* ──────────────── SOURCE CARD ──────────────── */}
      <Card className="border shadow-none">
        <CardContent className="p-6 sm:p-8 space-y-6">
          <StepHeader
            n={1}
            label="Step 1"
            title="Source material"
            required
          />

          <div className="space-y-2">
            <SectionLabel icon={Type} required>AliExpress title</SectionLabel>
            <Textarea
              value={aliTitle}
              onChange={(e) => setAliTitle(e.target.value)}
              placeholder="ROSES Pearl Gorgeous Prom Dress Sweetheart Off the Shoulder Hollow Prom Gown..."
              className="min-h-[92px] resize-none text-sm leading-relaxed"
              disabled={generating}
            />
            <div className="flex items-start justify-between gap-3 text-[11px] text-muted-foreground/70">
              <span className="leading-snug">
                Autopilot reads this to extract the keyword, category, audience &amp; style.
              </span>
              <span className="tabular-nums shrink-0 font-medium">
                {aliTitle.length} chars
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <SectionLabel icon={ImageIcon} required>Product images</SectionLabel>
            <SeoImageUploader
              images={images}
              onChange={setImages}
              disabled={generating}
            />
            <p className="text-[11px] text-muted-foreground/70 leading-snug">
              Upload your Nano Banana regenerated photos — never raw AliExpress files. Sonnet sees them for the compliance check and alt text.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ──────────────── VARIATIONS CARD (always visible) ──────────────── */}
      <Card className="border shadow-none">
        <CardContent className="p-6 sm:p-8 space-y-6">
          <StepHeader n={2} label="Step 2" title="Variations" required />

          <div className="space-y-2">
            <SectionLabel icon={Ruler}>Available sizes</SectionLabel>
            <SizeSelector
              values={sizes}
              onChange={setSizes}
              disabled={generating}
            />
          </div>

          <div className="space-y-2">
            <SectionLabel icon={Palette}>Available variants</SectionLabel>
            <VariantSelector
              values={variants}
              onChange={setVariants}
              disabled={generating}
            />
          </div>
        </CardContent>
      </Card>

      {/* ──────────────── CTA ──────────────── */}
      {/* The CTA + validation messages disappear once a listing has
          been generated. The "Start a new listing" link inside the
          result panel handles the restart path from then on. */}
      {!result && (
        <div className="space-y-2">
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={!canSubmit}
            className="w-full h-14 gap-2.5 bg-gradient-to-r from-[#F1641E] via-orange-500 to-violet-600 hover:from-[#F1641E] hover:via-orange-500 hover:to-violet-600 text-white font-semibold text-[15px] shadow-lg shadow-orange-500/25 ring-1 ring-orange-700/30 hover:opacity-95 hover:shadow-xl hover:shadow-orange-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Generating your listing…
              </>
            ) : (
              <>
                <Wand2 className="size-4" /> Generate Etsy listing
              </>
            )}
          </Button>
          {!generating && (aliTitle.length > 0 || images.length > 0) && (
            <div className="space-y-0.5">
              {!titleValid && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center">
                  Paste at least 8 characters of title text.
                </p>
              )}
              {!imagesValid && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center">
                  Upload at least one product image.
                </p>
              )}
            </div>
          )}
          {(aliTitle || images.length > 0 || sizes.length > 0 || variants.length > 0) &&
            !generating && (
              <button
                type="button"
                onClick={handleReset}
                className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center gap-1.5 py-1"
              >
                <RotateCw className="size-3" /> Reset everything
              </button>
            )}
        </div>
      )}

      {/* ──────────────── OUTPUT ──────────────── */}
      {generating && <ProgressCard stage={stage} />}
      {errorMsg && !generating && <ErrorCard message={errorMsg} />}
      {result && !generating && result.compliance.verdict === "BLOCKED" && (
        <BlockedCard verdict={result.compliance} />
      )}
      {result &&
        !generating &&
        result.compliance.verdict !== "BLOCKED" &&
        result.listing && (
          <>
            <ResultCard
              key={result.generatedAt}
              data={result}
              userImages={images}
            />
            <InsightsCard data={result} />
          </>
        )}

      {/* Restart path — only visible after a generation. The CTA above
          is hidden once `result` is set, so this is how the user
          starts a fresh listing. */}
      {result && !generating && (
        <div className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            className="w-full h-11 gap-2 text-sm font-semibold border-dashed hover:border-solid hover:bg-muted/40"
          >
            <RotateCw className="size-4" />
            Start a new listing
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Hero banner (matches the price calculator's premium banner) ────

function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#F1641E] via-orange-600 to-violet-700 shadow-xl shadow-orange-500/25 ring-1 ring-orange-700/40">
      {/* Glow blobs for depth */}
      <div
        aria-hidden
        className="absolute -top-20 -left-16 size-64 rounded-full bg-amber-300/30 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute -bottom-24 -right-16 size-72 rounded-full bg-violet-400/35 blur-3xl pointer-events-none"
      />
      {/* Diagonal stripe texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent 0, transparent 20px, rgba(255,255,255,0.6) 20px, rgba(255,255,255,0.6) 21px)",
        }}
      />

      <div className="relative flex flex-col sm:flex-row sm:items-center gap-5 px-6 sm:px-8 py-6 sm:py-7">
        {/* Frosted-glass icon chip with pulsing halo */}
        <div className="relative shrink-0">
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-white/40 animate-pulse blur-md"
          />
          <div className="relative size-14 rounded-2xl bg-white/15 ring-1 ring-white/40 flex items-center justify-center backdrop-blur-sm shadow-inner">
            <Sparkles className="size-7 text-white" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.18em] uppercase bg-white/15 backdrop-blur-sm px-2 py-0.5 rounded-full ring-1 ring-white/25">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-300" />
              </span>
              Private beta · CEO only
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white/90 tracking-wider uppercase bg-black/15 backdrop-blur-sm px-2 py-0.5 rounded-full">
              <ShieldCheck className="size-3" />
              Strict compliance gate
            </span>
          </div>
          <h2 className="text-2xl sm:text-[26px] font-bold text-white tracking-tight leading-tight">
            SEO Autopilot
          </h2>
          <p className="text-[13px] sm:text-sm text-white/85 mt-1.5 leading-snug max-w-xl">
            Drop your AliExpress title + 2 product photos. Autopilot
            researches live Etsy data, checks compliance, then writes the
            complete listing for you to paste into Etsy.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step header (used by Source + Variations cards) ────────────────

function StepHeader({
  n,
  label,
  title,
  hint,
  required,
}: {
  n: number;
  label: string;
  title: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0">
        <div className="size-9 rounded-xl bg-gradient-to-br from-orange-500/15 via-orange-500/10 to-violet-500/15 ring-1 ring-orange-500/25 flex items-center justify-center">
          <span className="text-[13px] font-bold tabular-nums text-orange-600 dark:text-orange-400">
            {n}
          </span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.18em]">
            {label}
          </p>
          {required && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              Required
            </span>
          )}
          {hint && !required && (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              · {hint}
            </span>
          )}
        </div>
        <h3 className="text-base font-bold tracking-tight leading-tight mt-0.5">
          {title}
        </h3>
      </div>
    </div>
  );
}

// ─── Section label (used inside step cards) ─────────────────────────

function SectionLabel({
  children,
  icon: Icon,
  required,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  required?: boolean;
}) {
  return (
    <label className="text-[11px] font-semibold text-foreground/80 uppercase tracking-[0.16em] flex items-center gap-1.5">
      {Icon && <Icon className="size-3" />}
      {children}
      {required && (
        <span
          className="text-rose-500 dark:text-rose-400 normal-case tracking-normal font-bold leading-none"
          aria-label="required"
          title="Required"
        >
          *
        </span>
      )}
    </label>
  );
}




// ─── Progress / Error / Blocked ─────────────────────────────────────

function ProgressCard({
  stage,
}: {
  stage: "idle" | "reading" | "checking" | "researching" | "writing" | "auditing";
}) {
  const order = ["reading", "checking", "researching", "writing", "auditing"] as const;
  const idx = order.indexOf(stage as (typeof order)[number]);
  const labels = {
    reading: "Reading your title",
    checking: "Strict compliance check",
    researching: "Researching live Etsy data",
    writing: "Writing your listing",
    auditing: "Final rule check",
  } as const;
  return (
    <Card className="border shadow-none overflow-hidden relative">
      {/* Subtle gradient backdrop — calls out that something's happening */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-orange-50/60 via-card to-violet-50/40 dark:from-orange-950/15 dark:via-card dark:to-violet-950/15 pointer-events-none"
      />
      <CardContent className="relative p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute inset-0 rounded-xl bg-orange-500/30 animate-pulse blur-md"
            />
            <div className="relative size-12 rounded-xl bg-gradient-to-br from-orange-500 to-violet-600 ring-1 ring-orange-600/30 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Loader2 className="size-6 text-white animate-spin" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold tracking-tight">
              Autopilot is working
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Usually 25–40 seconds with images.
            </p>
          </div>
        </div>
        <div className="space-y-2 pl-1">
          {order.map((s, i) => {
            const done = i < idx;
            const active = i === idx;
            return (
              <div
                key={s}
                className="flex items-center gap-3 text-xs"
              >
                {done ? (
                  <Check className="size-4 text-emerald-500 shrink-0" strokeWidth={3} />
                ) : active ? (
                  <Loader2 className="size-4 text-orange-500 animate-spin shrink-0" />
                ) : (
                  <div className="size-4 rounded-full border-2 border-muted shrink-0" />
                )}
                <span
                  className={
                    done || active ? "text-foreground" : "text-muted-foreground/60"
                  }
                >
                  {labels[s]}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-rose-300/50 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 shadow-none">
      <CardContent className="p-5 flex items-start gap-3">
        <AlertTriangle className="size-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
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

function BlockedCard({ verdict }: { verdict: ComplianceVerdict }) {
  return (
    <Card className="border-rose-400 dark:border-rose-700 bg-rose-50/60 dark:bg-rose-950/30 shadow-none">
      <CardContent className="p-6 sm:p-7 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-rose-500/20 ring-1 ring-rose-500/40 flex items-center justify-center shrink-0">
            <Ban className="size-5 text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.18em]">
              Blocked
            </p>
            <h3 className="text-lg font-bold text-rose-900 dark:text-rose-200 leading-tight">
              Do not list this on Etsy
            </h3>
          </div>
        </div>

        <p className="text-sm text-foreground leading-relaxed">
          {verdict.summary}
        </p>

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.16em]">
            Why
          </p>
          <ul className="space-y-1.5">
            {verdict.concerns.map((c, i) => (
              <li
                key={i}
                className="text-[12px] text-foreground/85 flex gap-2 items-start"
              >
                <span className="mt-1 size-1.5 rounded-full bg-rose-500 shrink-0" />
                <span>
                  <span className="font-semibold uppercase text-[10px] tracking-wider opacity-70 mr-1.5">
                    {c.category}
                  </span>
                  {c.details}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-rose-700/90 dark:text-rose-300/80 leading-snug border-t border-rose-300/40 dark:border-rose-700/40 pt-3">
          Etsy can remove listings within hours of detecting IP/policy issues
          and may strike the shop. Source a different version of this product
          or pick something else to list.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Result card ─────────────────────────────────────────────────────

function ResultCard({
  data,
  userImages,
}: {
  data: GenerateResponse;
  userImages: UploadedImage[];
}) {
  const { listing, compliance, research, inputs } = data;

  // Mutable copies of tags + intel so the swap-tag UI can rewrite them
  // in place. The parent passes `key={data.generatedAt}` so a fresh
  // generation remounts this component and re-initializes state.
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
      // Add a synthesised TagDemand record for the new tag using the
      // demand data the API returned.
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
    toast.success("Tag swapped", { description: `${oldTag} → ${newSuggestion.tag}` });
  }

  return (
    <Card className="border shadow-none overflow-hidden">
      <CardContent className="p-6 sm:p-8">
        {/* Header — "listing ready" announcement */}
        <div className="flex flex-wrap items-start justify-between gap-3 pb-5 mb-5 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 ring-1 ring-emerald-700/30 flex items-center justify-center shadow-sm shadow-emerald-500/20 shrink-0">
              <ShieldCheck className="size-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.18em]">
                Generated listing
              </p>
              <h3 className="text-lg font-bold tracking-tight leading-tight">
                Ready to paste into Etsy
              </h3>
            </div>
          </div>
          <ComplianceChip verdict={compliance} />
        </div>

        {/* Auto-decisions chip row */}
        <DecisionStrip research={research} />

        {/* Compliance warnings (if REVIEW) */}
        {compliance.verdict === "REVIEW" && compliance.concerns.length > 0 && (
          <WarningStrip
            title="Review before listing"
            issues={compliance.concerns.map((c) => ({
              severity: c.severity,
              label: c.category,
              message: c.details,
            }))}
          />
        )}

        {/* ── FIELDS ── */}
        <Row
          label="Category"
          value={research.categoryPath}
          copyValue={research.categoryPath}
        />
        <Row label="Item type" value={TYPE_LABEL[listing.suggestedType]} />
        <Row
          label="When made"
          value={whenMadeLabel(listing.suggestedWhenMade)}
        />

        <Divider />

        <TitleRow title={listing.title} />
        <DescriptionRow description={listing.description} />

        {hasVariations && <Divider />}

        {hasVariations && inputs && (
          <VariationsRow sizes={inputs.sizes} variants={inputs.variants} />
        )}

        <Divider />

        <TagsRow
          tags={tags}
          intelligence={tagIntel}
          productTitle={research.searchKeyword}
          productType={research.productType}
          category={research.categoryPath}
          onSwap={handleSwapTag}
        />

        {listing.materials.length > 0 && (
          <Row
            label="Materials"
            value={listing.materials.join(", ")}
            copyValue={listing.materials.join(", ")}
          />
        )}

        {listing.attributes.length > 0 && (
          <AttributesRow attributes={listing.attributes} />
        )}

        <Divider />

        <AltTextRow altTexts={listing.altTexts} images={userImages} />
      </CardContent>
    </Card>
  );
}

// ─── Result building blocks ─────────────────────────────────────────

function ComplianceChip({ verdict }: { verdict: ComplianceVerdict }) {
  if (verdict.verdict === "ALLOWED") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 ring-1 ring-emerald-300/40 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 tracking-wider uppercase shrink-0">
        <ShieldCheck className="size-3" />
        Cleared
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-950/40 ring-1 ring-amber-300/40 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 tracking-wider uppercase shrink-0">
      <AlertTriangle className="size-3" />
      Review
    </div>
  );
}

function DecisionStrip({ research }: { research: ResearchSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-4 mb-2 text-[11px]">
      <DecisionChip label="Searched" value={research.searchKeyword} />
      <DecisionChip label="Category" value={research.categoryPath} />
      <DecisionChip
        label="Read"
        value={`${research.competitorsAnalyzed} listings`}
      />
      {research.audienceHint && (
        <DecisionChip label="Audience" value={research.audienceHint} />
      )}
    </div>
  );
}

function DecisionChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-1 max-w-full">
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </span>
      <span className="text-[11px] font-medium text-foreground truncate">
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
    <div className="mt-3 mb-1 rounded-lg border border-amber-300/50 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/15 px-3 py-2.5">
      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-1.5">
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
              <span className="font-semibold uppercase text-[9px] tracking-wider opacity-70 mr-1">
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
  return <div className="my-2 border-t border-border/60" />;
}

function Row({
  label,
  value,
  copyValue,
  valueClass,
}: {
  label: string;
  value: string;
  copyValue?: string;
  valueClass?: string;
}) {
  return (
    <div className="py-3 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-1">
          {label}
        </p>
        <p
          className={`text-sm font-medium text-foreground leading-relaxed break-words ${valueClass ?? ""}`}
        >
          {value}
        </p>
      </div>
      {copyValue && (
        <CopyButton value={copyValue} label={label.toLowerCase()} />
      )}
    </div>
  );
}


function TitleRow({ title }: { title: string }) {
  const pct = (title.length / TITLE_MAX) * 100;
  const tone =
    pct > 100
      ? "rose"
      : pct >= 80
        ? "emerald"
        : pct >= 50
          ? "amber"
          : "muted";
  return (
    <div className="py-4">
      <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-orange-50/60 via-card to-violet-50/40 dark:from-orange-950/15 dark:via-card dark:to-violet-950/15 ring-1 ring-orange-500/10">
        <div className="p-5 sm:p-6 space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-gradient-to-br from-orange-500/15 to-violet-500/15 ring-1 ring-orange-500/25 flex items-center justify-center">
                <Type className="size-4 text-orange-600 dark:text-orange-400" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-700/80 dark:text-orange-300/80">
                Title
              </p>
            </div>
            <CopyButton value={title} label="title" />
          </div>
          <p className="text-base sm:text-lg font-semibold leading-snug break-words text-foreground">
            {title}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-muted/70 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  tone === "rose"
                    ? "bg-rose-500"
                    : tone === "emerald"
                      ? "bg-emerald-500"
                      : tone === "amber"
                        ? "bg-amber-500"
                        : "bg-muted-foreground/40"
                }`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <p
              className={`text-[11px] font-bold tabular-nums ${
                tone === "rose"
                  ? "text-rose-600 dark:text-rose-400"
                  : tone === "emerald"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : tone === "amber"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
              }`}
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
    <div className="py-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Description
          </p>
          <span className="text-[10px] tabular-nums font-medium text-muted-foreground/60">
            · {description.length} chars
          </span>
        </div>
        <CopyButton value={description} label="description" />
      </div>
      <div
        className={`rounded-xl border bg-muted/20 px-4 py-3.5 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90 ${
          expanded || !isLong ? "" : "max-h-[160px] overflow-hidden relative"
        }`}
      >
        {description}
        {!expanded && isLong && (
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted/40 via-muted/20 to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
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
    <div className="py-3.5 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Variations
      </p>
      {sizes.length > 0 && (
        <ChipDisplay label="Sizes" values={sizes} copyAll />
      )}
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
      <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider mr-1">
        {label}
      </span>
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium"
        >
          {v}
        </span>
      ))}
      {copyAll && (
        <CopyButton value={values.join(", ")} label={label.toLowerCase()} size="xs" />
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
    <div className="py-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Tags{" "}
          <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
            · {tags.length}/13 · tap to copy · ↻ to swap
          </span>
        </p>
        <button
          type="button"
          onClick={copyAll}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60 text-foreground/80 transition-colors"
        >
          <Copy className="size-3" /> Copy all
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, idx) => {
          const intel = intelByTag.get(tag);
          return (
            <TagPillWithSwap
              key={`${tag}-${idx}-${tag.length}`}
              tag={tag}
              intel={intel}
              productTitle={productTitle}
              productType={productType}
              category={category}
              existingTags={tags}
              onSwap={(suggestion) => onSwap(tag, suggestion)}
            />
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
        className={`inline-flex items-center gap-1 rounded-full ring-1 transition-colors ${
          isLong
            ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 ring-rose-300/50"
            : copied
              ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 ring-emerald-300/50"
              : "bg-card hover:bg-muted/50 text-foreground/85 ring-border"
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
            <Check className="size-3 text-emerald-600" />
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
              className="size-6 rounded-full hover:bg-muted/60 text-muted-foreground hover:text-foreground flex items-center justify-center mr-0.5"
              title="Suggest replacement tags"
            />
          }
        >
          <Shuffle className="size-3" />
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="start"
        className="w-80 p-3 space-y-3"
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
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
            {suggestions.map((s) => (
              <li key={s.tag}>
                <button
                  type="button"
                  onClick={() => handlePickSuggestion(s)}
                  className="w-full text-left rounded-md border bg-card hover:bg-muted/40 px-2.5 py-2 transition-colors"
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

function AttributesRow({
  attributes,
}: {
  attributes: { name: string; value: string }[];
}) {
  return (
    <div className="py-3.5 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Category attributes{" "}
        <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
          · {attributes.length} pre-filled
        </span>
      </p>
      <div className="grid sm:grid-cols-2 gap-x-6">
        {attributes.map((a, i) => (
          <div
            key={`${a.name}-${i}`}
            className="py-1.5 flex items-center justify-between gap-2 border-b border-border/40 last:border-0"
          >
            <div className="min-w-0">
              <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
                {a.name}
              </p>
              <p className="text-[12px] font-medium text-foreground truncate">
                {a.value}
              </p>
            </div>
            <CopyButton value={a.value} label={a.name} size="xs" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AltTextRow({
  altTexts,
  images,
}: {
  altTexts: string[];
  images: UploadedImage[];
}) {
  if (altTexts.length === 0) return null;
  return (
    <div className="py-3.5 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Image alt text
      </p>
      <div className="space-y-2">
        {altTexts.map((alt, idx) => {
          const img = images[idx];
          return (
            <div
              key={idx}
              className="rounded-md bg-muted/30 px-3 py-2 flex gap-3 items-start"
            >
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.previewUrl}
                  alt=""
                  className="size-12 rounded-md object-cover shrink-0 ring-1 ring-border"
                />
              ) : (
                <div className="size-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <ImageIcon className="size-4 text-muted-foreground/40" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
                    Image {idx + 1}
                  </p>
                  <CopyButton value={alt} label={`image ${idx + 1} alt`} size="xs" />
                </div>
                <p className="text-[12px] text-foreground/90 leading-relaxed italic">
                  &ldquo;{alt}&rdquo;
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Insights card (collapsible) ────────────────────────────────────

function InsightsCard({ data }: { data: GenerateResponse }) {
  const [open, setOpen] = useState(false);
  const tagIntel = data.tagIntelligence ?? [];
  const anchors = data.anchorKeywords;
  const buyerKeywords = data.buyerKeywords ?? [];
  const hasAnchors =
    !!anchors &&
    (anchors.topPhrases.length > 0 || anchors.topTags.length > 0);
  const hasBuyerKeywords = buyerKeywords.length > 0;
  const hasInsights =
    tagIntel.length > 0 ||
    data.research.topCompetitors.length > 0 ||
    data.listing?.rationale.keywordFocus ||
    hasAnchors ||
    hasBuyerKeywords;

  if (!hasInsights) return null;

  return (
    <Card className="border shadow-none overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left transition-colors hover:bg-muted/30"
      >
        <div className="p-6 sm:p-7 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 rounded-xl bg-gradient-to-br from-emerald-500/15 via-emerald-500/10 to-sky-500/15 ring-1 ring-emerald-500/25 flex items-center justify-center shrink-0">
              <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.18em]">
                Deep dive
              </p>
              <h3 className="text-base font-bold tracking-tight leading-tight mt-0.5">
                More insights
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Buyer searches · anchor keywords · tag demand · competitors · strategy
              </p>
            </div>
          </div>
          <ChevronDown
            className={`size-5 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="px-6 sm:px-7 pb-6 sm:pb-7 space-y-7 border-t pt-6">
          {hasBuyerKeywords && (
            <BuyerKeywordsSection buyerKeywords={buyerKeywords} />
          )}
          {hasAnchors && anchors && <AnchorKeywordsSection anchors={anchors} />}
          {tagIntel.length > 0 && <TagIntelligenceTable intel={tagIntel} />}
          {data.listing?.rationale.keywordFocus && (
            <RationaleSection rationale={data.listing.rationale} />
          )}
          {data.research.topCompetitors.length > 0 && (
            <CompetitorsSection
              competitors={data.research.topCompetitors}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function BuyerKeywordsSection({
  buyerKeywords,
}: {
  buyerKeywords: BuyerKeywordScore[];
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Buyer-search keywords
        </p>
        <p className="text-[11px] text-muted-foreground/80 leading-snug">
          Long-tail variants Autopilot brainstormed, scored against live
          Etsy demand. These are what real buyers TYPE into the search
          bar — higher signal than what competitors wrote.
        </p>
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold text-left">Phrase</th>
              <th className="px-3 py-2 font-semibold text-right">Listings</th>
              <th className="px-3 py-2 font-semibold text-right">Top favs</th>
              <th className="px-3 py-2 font-semibold text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {buyerKeywords.map((kw) => (
              <tr key={kw.keyword} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-5 rounded-full flex items-center justify-center text-[10px] ring-1 ${TIER_STYLE[kw.tier]}`}
                    >
                      {TIER_GLYPH[kw.tier]}
                    </span>
                    <span className="font-medium">{kw.keyword}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCount(kw.totalListings)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {kw.avgTopFavorites.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <DemandBar score={kw.buyerScore} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnchorKeywordsSection({ anchors }: { anchors: AnchorKeywords }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Anchor keywords
        </p>
        <p className="text-[11px] text-muted-foreground/80 leading-snug">
          High-frequency phrases + tags pulled from the top{" "}
          {anchors.totalListings} ranking listings. Autopilot front-loads these
          in the title and tag set to mirror what&apos;s already winning.
        </p>
      </div>

      {anchors.topPhrases.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            Phrases (title signal)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {anchors.topPhrases.map((p) => (
              <span
                key={p.phrase}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 ring-1 ring-border px-2.5 py-0.5 text-[11px]"
                title={`${p.count} of ${anchors.totalListings} listings`}
              >
                <span className="font-medium">{p.phrase}</span>
                <span className="text-[9px] font-bold text-muted-foreground tabular-nums">
                  {p.percentage}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {anchors.topTags.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            Tags (seller-curated signal)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {anchors.topTags.map((t) => (
              <span
                key={t.phrase}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-300/40 px-2.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300"
                title={`${t.count} of ${anchors.totalListings} listings`}
              >
                <span className="font-medium">{t.phrase}</span>
                <span className="text-[9px] font-bold tabular-nums">
                  {t.percentage}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TagIntelligenceTable({ intel }: { intel: TagDemand[] }) {
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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Tag intelligence — live Etsy demand
        </p>
        <div className="flex items-center gap-1">
          {(["niche", "moderate", "hot", "saturated"] as TagTier[]).map((t) =>
            counts[t] ? (
              <span
                key={t}
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${TIER_STYLE[t]}`}
                title={TIER_DESCRIPTION[t]}
              >
                <span>{TIER_GLYPH[t]}</span>
                <span>{counts[t]}</span>
              </span>
            ) : null,
          )}
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
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
            {sorted.map((r) => (
              <tr key={r.tag} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-5 rounded-full flex items-center justify-center text-[10px] ring-1 ${TIER_STYLE[r.tier]}`}
                    >
                      {TIER_GLYPH[r.tier]}
                    </span>
                    <span>{r.tag}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.error ? "—" : formatCount(r.totalListings)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {r.error ? "—" : r.avgTopFavorites.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <DemandBar score={r.demandScore} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        Etsy doesn&apos;t share real search volume. These are live counts from{" "}
        <code>/listings/active</code> for each tag — a strong proxy for demand
        and competition.
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
      className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1 ${
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
      ? "rose"
      : score >= 50
        ? "amber"
        : score >= 25
          ? "emerald"
          : "sky";
  return (
    <div className="inline-flex items-center gap-2">
      <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${
            tone === "rose"
              ? "bg-rose-500"
              : tone === "amber"
                ? "bg-amber-500"
                : tone === "emerald"
                  ? "bg-emerald-500"
                  : "bg-sky-500"
          }`}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums font-semibold w-7 text-right">
        {score}
      </span>
    </div>
  );
}

function RationaleSection({
  rationale,
}: {
  rationale: GeneratedListing["rationale"];
}) {
  const rows = [
    {
      label: "Keyword focus",
      value: rationale.keywordFocus,
      icon: Hash,
      tone: "orange" as const,
    },
    {
      label: "Title strategy",
      value: rationale.titleStrategy,
      icon: Type,
      tone: "amber" as const,
    },
    {
      label: "Audience hook",
      value: rationale.audienceHook,
      icon: Heart,
      tone: "violet" as const,
    },
  ].filter((r) => r.value);
  if (rows.length === 0) return null;

  const toneStyles = {
    amber:
      "bg-amber-50/60 dark:bg-amber-950/20 ring-amber-500/20 text-amber-700 dark:text-amber-400",
    orange:
      "bg-orange-50/60 dark:bg-orange-950/20 ring-orange-500/20 text-orange-700 dark:text-orange-400",
    violet:
      "bg-violet-50/60 dark:bg-violet-950/20 ring-violet-500/20 text-violet-700 dark:text-violet-400",
  } as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="size-7 rounded-lg bg-gradient-to-br from-amber-500/15 to-orange-500/15 ring-1 ring-amber-500/25 flex items-center justify-center shrink-0">
          <Lightbulb className="size-3.5 text-amber-600 dark:text-amber-400" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Why this works
        </p>
      </div>
      <div className="grid gap-2">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div
              key={r.label}
              className={`rounded-xl ring-1 px-4 py-3 flex items-start gap-3 ${toneStyles[r.tone]}`}
            >
              <div
                className={`size-8 rounded-lg bg-card/80 ring-1 ${toneStyles[r.tone]} flex items-center justify-center shrink-0`}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[10px] font-bold uppercase tracking-[0.16em] ${toneStyles[r.tone].split(" ").pop()}`}
                >
                  {r.label}
                </p>
                <p className="text-[12px] text-foreground/85 leading-relaxed mt-0.5">
                  {r.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompetitorsSection({
  competitors,
}: {
  competitors: { rank: number; title: string; favorites: number }[];
}) {
  // Pick a tone for each rank — the #1 listing gets a gold "Crown" chip,
  // the others get a clean neutral chip with the rank number.
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
      <div className="flex items-center gap-2">
        <div className="size-7 rounded-lg bg-gradient-to-br from-amber-400/15 to-orange-500/15 ring-1 ring-amber-500/25 flex items-center justify-center shrink-0">
          <Crown className="size-3.5 text-amber-600 dark:text-amber-400" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Top 5 competitors Autopilot read
        </p>
      </div>
      <ul className="space-y-2">
        {competitors.map((c) => {
          const t = rankTone(c.rank);
          return (
            <li
              key={c.rank}
              className="rounded-xl border bg-card hover:bg-muted/30 transition-colors px-3.5 py-3 flex items-start gap-3"
            >
              {/* Rank chip — gold for #1, silver #2, bronze #3 */}
              <div
                className={`size-9 rounded-xl ring-1 flex items-center justify-center shrink-0 shadow-sm ${t.bg} ${t.ring}`}
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
              {/* Title + favorites */}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-foreground/90 leading-snug line-clamp-2">
                  {c.title}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                    <Heart className="size-2.5 text-rose-500" fill="currentColor" />
                    <span className="tabular-nums">
                      {c.favorites.toLocaleString()}
                    </span>
                    <span className="font-normal">favorites</span>
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
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md hover:bg-muted/60 text-muted-foreground transition-colors shrink-0"
      >
        {copied ? (
          <Check className="size-3 text-emerald-500" />
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
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60 text-foreground/80 transition-colors shrink-0"
    >
      {copied ? (
        <>
          <Check className="size-3 text-emerald-500" /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3" /> Copy
        </>
      )}
    </button>
  );
}

