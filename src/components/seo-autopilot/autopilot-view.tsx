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
  TrendingUp,
  ImageIcon,
  Shuffle,
  Ruler,
  Palette,
  Type,
  Lightbulb,
  Crown,
  Eye,
  Search,
  PenLine,
  Zap,
  Target,
  Award,
  Gauge,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { SeoImageUploader, type UploadedImage } from "./image-uploader";
import { SizeSelector, VariantSelector } from "./option-selectors";

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
interface GenerateResponse {
  compliance: ComplianceVerdict;
  listing: GeneratedListing | null;
  research: ResearchSummary;
  anchorKeywords?: AnchorKeywords;
  tagIntelligence?: TagDemand[];
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
 * with { aliExpressTitle, images, sizes, variants }, same response shape.
 */
export function SeoAutopilotView({ isCeo = false }: { isCeo?: boolean }) {
  // ─── Form state ───────────────────────────────────────────────────
  const [aliTitle, setAliTitle] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [variants, setVariants] = useState<string[]>([]);

  // ─── Generation state ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ─── Quota state ──────────────────────────────────────────────────
  // Just the user-facing usage chip ("3 / 8 today"). The full team
  // analytics dashboard lives at /seo-autopilot/dashboard (CEO-only).
  const [usage, setUsage] = useState<UsageSummary | null>(null);

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
    fetchUsage();
    return () => {
      cancelled = true;
    };
    // Re-fetch when result.generatedAt changes (after a successful gen)
    // so the chip stays accurate.
  }, [result?.generatedAt]);

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
    setResult(null);
    setErrorMsg(null);
  }

  const showInput = !generating && !result;
  const showResult =
    !!result && !generating && result.compliance.verdict !== "BLOCKED" && !!result.listing;

  return (
    <div className="relative">
      {/* Page background — radial gradient + dot mesh that's barely there */}
      <PageBackdrop />

      <div className="relative max-w-3xl mx-auto space-y-6 pb-16 pt-1">
        <HeroBanner
          generating={generating}
          hasResult={!!result}
          usage={usage}
          isCeo={isCeo}
        />

        {/* ──────────────── INPUT ──────────────── */}
        {showInput && (
          <div className="space-y-5 ap-stagger-in" style={{ animationDelay: "120ms" }}>
            <SourceCard
              aliTitle={aliTitle}
              onAliTitleChange={setAliTitle}
              images={images}
              onImagesChange={setImages}
              disabled={generating}
              titleValid={titleValid}
              imagesValid={imagesValid}
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
                variants.length > 0
              }
              usage={usage}
              atLimit={atLimit}
              onGenerate={handleGenerate}
              onReset={handleReset}
            />
          </div>
        )}

        {/* ──────────────── GENERATING ──────────────── */}
        {generating && <GenerationCinema stage={stage} />}

        {/* ──────────────── ERROR ──────────────── */}
        {errorMsg && !generating && <ErrorPanel message={errorMsg} />}

        {/* ──────────────── BLOCKED ──────────────── */}
        {result &&
          !generating &&
          result.compliance.verdict === "BLOCKED" && (
            <BlockedPanel verdict={result.compliance} onReset={handleReset} />
          )}

        {/* ──────────────── RESULT ──────────────── */}
        {showResult && result && (
          <>
            <ResultPanel
              key={result.generatedAt}
              data={result}
              userImages={images}
            />
            <InsightsDrawer data={result} />
            <RestartButton onReset={handleReset} />
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

// ─── Hero banner — premium animated aurora ──────────────────────────

function HeroBanner({
  generating,
  hasResult,
  usage,
  isCeo,
}: {
  generating: boolean;
  hasResult: boolean;
  usage: UsageSummary | null;
  isCeo: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-orange-500/20 ap-stagger-in">
      {/* Base gradient + dark wash so the aurora pops */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a0d1f] via-[#2a1612] to-[#1a0d1f]" />

      {/* Animated aurora blobs */}
      <div
        aria-hidden
        className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl ap-aurora-1"
        style={{
          background:
            "radial-gradient(closest-side, rgba(241,100,30,0.85), rgba(241,100,30,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl ap-aurora-2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(124,58,237,0.75), rgba(124,58,237,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-1/3 right-1/4 size-[300px] rounded-full blur-3xl ap-aurora-3"
        style={{
          background:
            "radial-gradient(closest-side, rgba(244,114,182,0.55), rgba(244,114,182,0) 70%)",
        }}
      />

      {/* Subtle dot pattern for texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />

      {/* Top highlight + bottom darkening for depth */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />

      <div className="relative px-7 sm:px-9 py-8 sm:py-10">
        {/* Status pills */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20 shadow-inner">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            Private beta · CEO only
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/90 tracking-[0.16em] uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
            <ShieldCheck className="size-3" />
            Strict compliance gate
          </span>
          {hasResult && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-200 tracking-[0.16em] uppercase bg-emerald-500/20 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-emerald-300/30">
              <Check className="size-3" />
              Listing ready
            </span>
          )}
          {generating && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.16em] uppercase bg-orange-500/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-orange-300/40">
              <Loader2 className="size-3 animate-spin" />
              Generating
            </span>
          )}
          {usage && <UsagePill usage={usage} />}
          {isCeo && (
            <Link
              href="/seo-autopilot/dashboard"
              className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.16em] uppercase bg-white/10 hover:bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20 transition-colors"
            >
              <TrendingUp className="size-3" />
              Dashboard
            </Link>
          )}
        </div>

        {/* Title + icon */}
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-orange-400/40 to-violet-500/40 blur-lg ap-orb-pulse"
            />
            <div className="relative size-16 sm:size-[68px] rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-orange-900/40">
              <Sparkles className="size-7 sm:size-8 text-white drop-shadow-lg" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.05]">
              SEO Autopilot
            </h1>
            <p className="text-[13px] sm:text-sm text-white/75 mt-2 leading-relaxed max-w-xl">
              Drop your AliExpress title + 2 product photos. Autopilot
              researches live Etsy data, checks compliance, then writes the
              complete listing for you to paste into Etsy.
            </p>
          </div>
        </div>

        {/* Bottom feature strip */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          <FeatureCell
            icon={Eye}
            label="Compliance"
            sub="Strict IP check"
          />
          <FeatureCell
            icon={Search}
            label="Research"
            sub="20 top listings"
          />
          <FeatureCell
            icon={PenLine}
            label="Writes copy"
            sub="Title · tags · desc"
          />
        </div>
      </div>
    </div>
  );
}

function UsagePill({ usage }: { usage: UsageSummary }) {
  if (usage.isUnlimited) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px] font-bold text-violet-100 tracking-[0.16em] uppercase bg-violet-500/25 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-violet-300/30"
        title="CEO — no daily cap"
      >
        <Crown className="size-3" />
        Unlimited
      </span>
    );
  }
  const remaining = Math.max(0, usage.remaining);
  const ratio = usage.count / Math.max(1, usage.limit);
  // Color: emerald at low use, amber at 80%+, rose at limit
  const tone =
    remaining === 0
      ? "rose"
      : ratio >= 0.8
        ? "amber"
        : "emerald";
  const cls = {
    rose: "bg-rose-500/25 text-rose-100 ring-rose-300/30",
    amber: "bg-amber-500/25 text-amber-100 ring-amber-300/30",
    emerald: "bg-emerald-500/25 text-emerald-100 ring-emerald-300/30",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] uppercase backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ${cls}`}
      title={`${usage.count} of ${usage.limit} generations today (resets at midnight PKT)`}
    >
      <Gauge className="size-3" />
      {remaining === 0 ? "Daily limit reached" : `${usage.count} / ${usage.limit} today`}
    </span>
  );
}

function FeatureCell({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="size-8 rounded-lg bg-white/10 ring-1 ring-white/15 flex items-center justify-center shrink-0">
        <Icon className="size-4 text-white/90" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] sm:text-[12px] font-semibold text-white leading-tight truncate">
          {label}
        </p>
        <p className="text-[10px] text-white/55 leading-tight truncate">{sub}</p>
      </div>
    </div>
  );
}

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
      <CardContent className="p-7 sm:p-8 space-y-7">
        <StepHeader
          stepN={1}
          eyebrow="Step one"
          title="Source material"
          subtitle="What Autopilot reads first"
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
              placeholder="ROSES Pearl Gorgeous Prom Dress Sweetheart Off the Shoulder Hollow Prom Gown..."
              className="min-h-[110px] resize-none text-sm leading-relaxed bg-muted/20 border-border/70 focus-visible:border-orange-500/60 focus-visible:ring-orange-500/15 transition-colors"
              disabled={disabled}
            />
            {/* Char counter floating in bottom-right */}
            <div className="absolute bottom-2.5 right-3 text-[10px] font-bold tabular-nums text-muted-foreground/60 bg-card/80 backdrop-blur-sm rounded px-1.5 py-0.5">
              {aliTitle.length}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground/75 leading-snug">
            Autopilot reads this to extract the keyword, category, audience &amp; style.
          </p>
        </div>

        {/* ── Product images ── */}
        <div className="space-y-2.5">
          <SectionLabel icon={ImageIcon} required filled={imagesValid}>
            Product images
          </SectionLabel>

          {/* CRITICAL compliance warning — raw AliExpress images get
              auto-flagged by our vision compliance gate as copyrighted /
              counterfeit (Etsy is strict on this, and the Haiku gate
              catches stock-photo watermarks + brand logos). Make this
              IMPOSSIBLE to miss — bright rose, all caps eyebrow, animated
              icon glow. */}
          <AliWarningBanner />

          <SeoImageUploader
            images={images}
            onChange={onImagesChange}
            disabled={disabled}
          />
          <p className="text-[11px] text-muted-foreground/75 leading-snug">
            Sonnet sees these for the compliance check and alt text. Use
            your Nano Banana / AI-regenerated photos only.
          </p>
        </div>
      </CardContent>
    </PremiumCard>
  );
}

// ─── AliExpress image warning banner ────────────────────────────────

/**
 * A prominent banner above the image uploader telling the user NOT to
 * upload raw AliExpress photos. Reads as a hard rule — bright rose
 * surface, animated icon halo, all-caps headline. The compliance gate
 * will block these anyway; this banner is what stops the upload before
 * it costs the user a quota slot.
 */
function AliWarningBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl border-2 border-rose-400/60 dark:border-rose-700/60 bg-gradient-to-br from-rose-50 via-rose-50/80 to-amber-50/40 dark:from-rose-950/40 dark:via-rose-950/30 dark:to-amber-950/15 shadow-md shadow-rose-500/15">
      {/* Diagonal warning-tape stripes for "stop, read this" vibes */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent 0, transparent 12px, rgba(244,63,94,0.6) 12px, rgba(244,63,94,0.6) 13px)",
        }}
      />
      {/* Pulsing left edge accent */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-500 via-rose-600 to-amber-500"
      />

      <div className="relative flex items-start gap-3 px-4 py-3.5 sm:px-5">
        {/* Icon chip with pulsing glow */}
        <div className="relative shrink-0 mt-0.5">
          <span
            aria-hidden
            className="absolute -inset-1 rounded-xl bg-rose-500/40 blur-md animate-pulse"
          />
          <div className="relative size-9 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 ring-1 ring-rose-800/30 flex items-center justify-center shadow-md shadow-rose-500/30">
            <AlertTriangle className="size-4 text-white" strokeWidth={2.5} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.22em]">
            Critical · read before uploading
          </p>
          <p className="text-[13px] sm:text-[14px] font-bold text-rose-900 dark:text-rose-100 leading-tight mt-1 tracking-tight">
            DO NOT upload AliExpress images.
          </p>
          <p className="text-[11px] sm:text-[12px] text-rose-800/90 dark:text-rose-200/90 mt-1.5 leading-relaxed">
            Our AI <strong>auto-flags</strong> them as copyrighted content,
            blocks the listing and burns one of your daily generations.
            Upload your <strong>regenerated (Nano Banana / AI)</strong> images only.
          </p>
        </div>
      </div>
    </div>
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
      <CardContent className="p-7 sm:p-8 space-y-7">
        <StepHeader
          stepN={2}
          eyebrow="Step two"
          title="Variations"
          subtitle="Sizes & options buyers can pick"
          required
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

// ─── Premium card wrapper ───────────────────────────────────────────

function PremiumCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border border-border/60 bg-card/95 backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_12px_36px_-12px_rgba(0,0,0,0.5)] overflow-hidden relative">
      {/* Top highlight line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      {children}
    </Card>
  );
}

// ─── Step header ────────────────────────────────────────────────────

function StepHeader({
  stepN,
  eyebrow,
  title,
  subtitle,
  required,
}: {
  stepN: number;
  eyebrow: string;
  title: string;
  subtitle: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <span
          aria-hidden
          className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-orange-400/30 to-violet-500/30 blur-md"
        />
        <div className="relative size-11 rounded-2xl bg-gradient-to-br from-orange-500 to-violet-600 ring-1 ring-orange-700/30 flex items-center justify-center shadow-lg shadow-orange-500/25">
          <span className="text-base font-bold tabular-nums text-white">
            {stepN}
          </span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.22em]">
            {eyebrow}
          </p>
          {required && (
            <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-400">
              Required
            </span>
          )}
        </div>
        <h3 className="text-[17px] font-bold tracking-tight leading-tight mt-1">
          {title}
        </h3>
        <p className="text-[12px] text-muted-foreground/80 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

// ─── Section label ──────────────────────────────────────────────────

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
    <label className="text-[11px] font-bold text-foreground/80 uppercase tracking-[0.18em] flex items-center gap-2">
      {Icon && (
        <span
          className={`size-5 rounded-md flex items-center justify-center ring-1 transition-colors ${
            filled
              ? "bg-emerald-500/15 ring-emerald-500/40 text-emerald-600 dark:text-emerald-400"
              : "bg-muted/40 ring-border/60 text-muted-foreground"
          }`}
        >
          {filled ? <Check className="size-3" strokeWidth={3} /> : <Icon className="size-3" />}
        </span>
      )}
      {children}
      {required && (
        <span
          className="text-rose-500 dark:text-rose-400 normal-case tracking-normal font-bold leading-none ml-0.5"
          aria-label="required"
          title="Required"
        >
          *
        </span>
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
              Generating your listing…
            </>
          ) : (
            <>
              <Wand2 className="size-5" />
              <span>Generate Etsy listing</span>
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
          {usage.remaining} of {usage.limit} generations left today · resets at midnight PKT
        </p>
      )}

      {!generating && aliTitleHasContent(titleValid, imagesValid) && (
        <div className="space-y-1">
          {!titleValid && (
            <ValidationLine text="Paste at least 8 characters of title text." />
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
          Reset everything
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
  const { listing, compliance, research, inputs } = data;

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
      </CardContent>
    </PremiumCard>
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
  if (altTexts.length === 0) return null;
  return (
    <div className="py-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
        Image alt text
      </p>
      <div className="space-y-2">
        {altTexts.map((alt, idx) => {
          const img = images[idx];
          return (
            <div
              key={idx}
              className="rounded-xl border border-border/60 bg-muted/15 px-3.5 py-3 flex gap-3 items-start"
            >
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.previewUrl}
                  alt=""
                  className="size-14 rounded-lg object-cover shrink-0 ring-1 ring-border"
                />
              ) : (
                <div className="size-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <ImageIcon className="size-4 text-muted-foreground/40" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[9px] font-bold text-muted-foreground/80 uppercase tracking-[0.18em]">
                    Image {idx + 1}
                  </p>
                  <CopyButton
                    value={alt}
                    label={`image ${idx + 1} alt`}
                    size="xs"
                  />
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

// ─── Insights drawer ────────────────────────────────────────────────

function InsightsDrawer({ data }: { data: GenerateResponse }) {
  const [open, setOpen] = useState(false);
  const tagIntel = data.tagIntelligence ?? [];
  const anchors = data.anchorKeywords;
  const hasAnchors =
    !!anchors &&
    (anchors.topPhrases.length > 0 || anchors.topTags.length > 0);
  const hasInsights =
    tagIntel.length > 0 ||
    data.research.topCompetitors.length > 0 ||
    data.listing?.rationale.keywordFocus ||
    hasAnchors;

  if (!hasInsights) return null;

  return (
    <PremiumCard>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left transition-colors hover:bg-muted/20"
      >
        <div className="p-6 sm:p-7 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="relative shrink-0">
              <span
                aria-hidden
                className="absolute -inset-1 rounded-2xl bg-emerald-400/20 blur-md"
              />
              <div className="relative size-10 rounded-2xl bg-gradient-to-br from-emerald-400/20 via-emerald-500/15 to-sky-500/20 ring-1 ring-emerald-500/30 flex items-center justify-center">
                <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.22em]">
                Deep dive
              </p>
              <h3 className="text-[17px] font-bold tracking-tight leading-tight mt-0.5">
                More insights
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Anchor keywords · tag demand · competitors · strategy
              </p>
            </div>
          </div>
          <ChevronDown
            className={`size-5 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="px-6 sm:px-7 pb-7 space-y-8 border-t border-border/60 pt-7">
          {hasAnchors && anchors && (
            <div className="ap-stagger-in" style={{ animationDelay: "0ms" }}>
              <AnchorKeywordsBlock anchors={anchors} />
            </div>
          )}
          {tagIntel.length > 0 && (
            <div className="ap-stagger-in" style={{ animationDelay: "100ms" }}>
              <TagIntelligenceBlock intel={tagIntel} />
            </div>
          )}
          {data.listing?.rationale.keywordFocus && (
            <div className="ap-stagger-in" style={{ animationDelay: "200ms" }}>
              <RationaleBlock rationale={data.listing.rationale} />
            </div>
          )}
          {data.research.topCompetitors.length > 0 && (
            <div className="ap-stagger-in" style={{ animationDelay: "300ms" }}>
              <CompetitorsBlock competitors={data.research.topCompetitors} />
            </div>
          )}
        </div>
      )}
    </PremiumCard>
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

function AnchorKeywordsBlock({ anchors }: { anchors: AnchorKeywords }) {
  return (
    <div className="space-y-3.5">
      <InsightsSectionHeader
        icon={Target}
        label="Anchor keywords"
        description={`High-frequency phrases + tags from the top ${anchors.totalListings} ranking listings — Autopilot front-loads these.`}
        tone="emerald"
      />

      {anchors.topPhrases.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold text-muted-foreground/80 uppercase tracking-[0.18em]">
            Phrases (title signal)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {anchors.topPhrases.map((p, i) => (
              <span
                key={p.phrase}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 ring-1 ring-border px-2.5 py-1 text-[11px] ap-tag-pop"
                style={{ animationDelay: `${i * 25}ms` }}
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
          <p className="text-[9px] font-bold text-muted-foreground/80 uppercase tracking-[0.18em]">
            Tags (seller-curated signal)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {anchors.topTags.map((t, i) => (
              <span
                key={t.phrase}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-300/40 px-2.5 py-1 text-[11px] text-emerald-700 dark:text-emerald-300 ap-tag-pop"
                style={{ animationDelay: `${i * 25}ms` }}
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

function RationaleBlock({
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
      <InsightsSectionHeader
        icon={Lightbulb}
        label="Why this works"
        description="Autopilot's strategic reasoning behind the title, keywords and hook."
        tone="violet"
      />
      <div className="grid gap-2">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <div
              key={r.label}
              className={`rounded-xl ring-1 px-4 py-3.5 flex items-start gap-3 ap-stagger-in ${toneStyles[r.tone]}`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div
                className={`size-9 rounded-lg bg-card/80 ring-1 ${toneStyles[r.tone]} flex items-center justify-center shrink-0`}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[10px] font-bold uppercase tracking-[0.22em] ${toneStyles[r.tone].split(" ").pop()}`}
                >
                  {r.label}
                </p>
                <p className="text-[12px] text-foreground/90 leading-relaxed mt-1">
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

// ─── Restart button ─────────────────────────────────────────────────

function RestartButton({ onReset }: { onReset: () => void }) {
  return (
    <div className="pt-3 ap-stagger-in" style={{ animationDelay: "800ms" }}>
      <Button
        type="button"
        variant="outline"
        onClick={onReset}
        className="w-full h-12 gap-2 text-sm font-semibold border-dashed border-2 hover:border-solid hover:bg-muted/40 transition-all"
      >
        <RotateCw className="size-4" />
        Start a new listing
      </Button>
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
