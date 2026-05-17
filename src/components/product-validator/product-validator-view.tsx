"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Link2,
  PenLine,
  Sparkles,
  ExternalLink,
  Package,
  Info,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Eye,
  Search,
  Scale,
  Gavel,
  ListChecks,
  Check,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import {
  SeoImageUploader,
  type UploadedImage,
} from "@/components/seo-autopilot/image-uploader";

/**
 * Product Validator.
 *
 * Sellers paste an aliexpress.com product URL or enter the title
 * manually with reference photos. The tool runs the title against
 * Etsy's published policy rules (Prohibited Items, IP/Trademark,
 * PPE, Creativity Standards) and returns a SAFE / REVIEW / BLOCKED
 * verdict with per-rule citations.
 *
 * Regional storefronts (.us / .ru / etc.) are rejected at the input
 * stage — sellers are instructed to change their AliExpress shipping
 * region to Pakistan to access the .com version of the same product.
 *
 * The validation pipeline runs through five visible stages and is
 * paced to a 10-second minimum so the work is legible to the seller.
 */

interface ValidationFlag {
  severity: "block" | "review";
  policy: string;
  policyClause: string;
  label: string;
  matchedText: string;
  explanation: string;
  suggestion?: string;
}

type Verdict = "BLOCKED" | "REVIEW" | "SAFE";

interface ValidatorResult {
  verdict: Verdict;
  summary: string;
  flags: ValidationFlag[];
  product: {
    title: string;
    imageUrl: string | null;
    priceUsd: number | null;
    productUrl: string;
    source: "com" | "manual";
  };
  fetchPath: "ds_api" | "manual";
  durationMs: number;
}

type InputMode = "url" | "manual";

type Stage =
  | "idle"
  | "reading"
  | "scanning"
  | "checking"
  | "reviewing"
  | "compiling";

/** Minimum visible duration of the loading panel. */
const MIN_LOADING_MS = 10_000;

const STAGE_ORDER: Exclude<Stage, "idle">[] = [
  "reading",
  "scanning",
  "checking",
  "reviewing",
  "compiling",
];

const STAGE_META: Record<
  Exclude<Stage, "idle">,
  { title: string; sub: string; icon: typeof Eye }
> = {
  reading: {
    title: "Reading the product",
    sub: "Pulling the title and listing details",
    icon: Eye,
  },
  scanning: {
    title: "Prohibited items scan",
    sub: "Weapons, drugs, hate, adult, animal products, PPE",
    icon: Search,
  },
  checking: {
    title: "IP and trademark check",
    sub: "Brand names, character likenesses, counterfeits",
    icon: Scale,
  },
  reviewing: {
    title: "Creativity standards review",
    sub: "Made / Designed / Handpicked / Sourced framing",
    icon: Gavel,
  },
  compiling: {
    title: "Compiling verdict",
    sub: "Ordering flags and writing recommendations",
    icon: ListChecks,
  },
};

const VERDICT_THEME: Record<
  Verdict,
  {
    ring: string;
    bg: string;
    bgSubtle: string;
    text: string;
    icon: typeof ShieldCheck;
    label: string;
  }
> = {
  SAFE: {
    ring: "ring-emerald-500/40",
    bg: "bg-emerald-500",
    bgSubtle: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    icon: ShieldCheck,
    label: "Cleared for listing",
  },
  REVIEW: {
    ring: "ring-amber-500/40",
    bg: "bg-amber-500",
    bgSubtle: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    icon: ShieldAlert,
    label: "Review required",
  },
  BLOCKED: {
    ring: "ring-rose-500/40",
    bg: "bg-rose-500",
    bgSubtle: "bg-rose-50 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    icon: ShieldX,
    label: "Do not list",
  },
};

export function ProductValidatorView() {
  const [mode, setMode] = useState<InputMode>("url");
  const [urlInput, setUrlInput] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualImages, setManualImages] = useState<UploadedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<ValidatorResult | null>(null);

  // Drive the visible stage timeline while loading. Each step is paced
  // at 2 seconds so the full sequence completes in 10s — the minimum
  // perceived effort window we want the seller to see.
  useEffect(() => {
    if (!loading) {
      setStage("idle");
      return;
    }
    setStage("reading");
    const timers: ReturnType<typeof setTimeout>[] = [];
    STAGE_ORDER.slice(1).forEach((next, i) => {
      timers.push(setTimeout(() => setStage(next), (i + 1) * 2000));
    });
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  function canSubmit(): boolean {
    if (loading) return false;
    if (mode === "url") return urlInput.trim().length >= 8;
    return manualTitle.trim().length >= 3;
  }

  /**
   * Validate URL input client-side. Regional storefronts are blocked
   * with a clear instruction to switch the AliExpress region to
   * Pakistan — that surfaces the .com version of the same product.
   */
  function handleUrlChange(value: string) {
    setUrlInput(value);
    if (value.length < 12) return;
    const isUsUrl = /aliexpress\.(us|ru|fr|de|es|it|pl|nl|co\.kr|co\.jp)/i.test(
      value,
    );
    if (isUsUrl) {
      toast.error("This validator only accepts aliexpress.com URLs", {
        description:
          "Open AliExpress, change the shipping region from United States to Pakistan, and copy the .com link for the same product.",
        duration: 9000,
      });
    }
  }

  async function handleValidate(): Promise<void> {
    if (!canSubmit()) return;

    // Hard block .us URLs before hitting the network.
    if (
      mode === "url" &&
      /aliexpress\.(us|ru|fr|de|es|it|pl|nl|co\.kr|co\.jp)/i.test(urlInput)
    ) {
      toast.error("This validator only accepts aliexpress.com URLs", {
        description:
          "Change the AliExpress shipping region from United States to Pakistan to view the .com version of this product.",
        duration: 9000,
      });
      return;
    }

    setLoading(true);
    setResult(null);

    const startedAt = Date.now();
    const body =
      mode === "url"
        ? { url: urlInput.trim() }
        : { manualTitle: manualTitle.trim() };

    try {
      const apiPromise = (async () => {
        const res = await fetch("/api/product-validator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const respBody = await res.json().catch(() => ({}));
          throw new Error(respBody?.error ?? `Request failed (${res.status})`);
        }
        return (await res.json()) as ValidatorResult;
      })();

      const data = await apiPromise;

      // Keep the loading panel up for at least MIN_LOADING_MS so the
      // seller perceives the validation as substantive work rather
      // than a single fetch.
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
      }

      // If the user uploaded local images for manual mode, override
      // the result's image with their first upload so the result card
      // shows what they were actually validating.
      const final: ValidatorResult =
        data.product.source === "manual" && manualImages.length > 0
          ? {
              ...data,
              product: {
                ...data.product,
                imageUrl: manualImages[0]?.previewUrl ?? data.product.imageUrl,
              },
            }
          : data;

      setResult(final);

      if (final.verdict === "SAFE") {
        toast.success("Cleared for listing", { description: final.summary });
      } else if (final.verdict === "REVIEW") {
        toast.warning("Review required", { description: final.summary });
      } else {
        toast.error("Do not list this product", {
          description: final.summary,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Validation failed";
      toast.error("Validation failed", { description: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative pb-12">
      {/* Full-bleed hero */}
      <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
        <HeroBanner />
      </div>

      <div className="max-w-5xl mx-auto space-y-5">
        {/* Input card — hidden while the loading cinema is on screen */}
        {!loading && (
          <Card className="border border-border/60 shadow-none">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 ring-1 ring-violet-500/30 flex items-center justify-center shadow shadow-violet-500/30">
                  <ShieldCheck className="size-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-600 dark:text-violet-400">
                    Pre-listing policy check
                  </p>
                  <h3 className="text-[16px] font-bold leading-tight">
                    {mode === "url"
                      ? "Paste an aliexpress.com product URL"
                      : "Enter the product manually"}
                  </h3>
                </div>
              </div>

              {/* Mode toggle */}
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-1 ring-1 ring-border/40">
                <ModeButton
                  active={mode === "url"}
                  onClick={() => setMode("url")}
                  disabled={loading}
                  icon={Link2}
                  gradient="from-violet-500 to-emerald-500"
                  label="Paste URL"
                  sub="aliexpress.com only"
                />
                <ModeButton
                  active={mode === "manual"}
                  onClick={() => setMode("manual")}
                  disabled={loading}
                  icon={PenLine}
                  gradient="from-emerald-500 to-amber-500"
                  label="Manual entry"
                  sub="Title and photos"
                />
              </div>

              {/* URL mode */}
              {mode === "url" && (
                <>
                  <Input
                    type="text"
                    value={urlInput}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSubmit()) handleValidate();
                    }}
                    placeholder="https://www.aliexpress.com/item/1005006123456789.html"
                    disabled={loading}
                    className="h-12 text-sm bg-muted/20 border-border/70 focus-visible:border-violet-500/60 focus-visible:ring-violet-500/15"
                  />
                  <UsUrlNotice />
                </>
              )}

              {/* Manual mode */}
              {mode === "manual" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="manual-title"
                      className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground"
                    >
                      Product title{" "}
                      <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="manual-title"
                      type="text"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canSubmit()) handleValidate();
                      }}
                      placeholder="Copy the product title exactly as it appears on AliExpress"
                      disabled={loading}
                      maxLength={500}
                      autoFocus
                      className="h-10 text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
                      Reference photos{" "}
                      <span className="text-muted-foreground/50 font-normal">
                        (up to 2)
                      </span>
                    </Label>
                    <SeoImageUploader
                      images={manualImages}
                      onChange={setManualImages}
                      disabled={loading}
                      maxImages={2}
                    />
                    <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                      AliExpress blocks image downloads. Take a screenshot of
                      the product photos and upload them here so the result
                      card shows the product you validated.
                    </p>
                  </div>
                </div>
              )}

              <Button
                type="button"
                onClick={handleValidate}
                disabled={!canSubmit()}
                className="w-full h-12 bg-gradient-to-r from-violet-500 to-emerald-500 hover:opacity-90 text-white font-bold rounded-xl shadow-lg shadow-violet-500/30 disabled:opacity-40"
              >
                <Sparkles className="size-4 mr-2" />
                Run validation
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Loading cinema */}
        {loading && <ValidationCinema stage={stage} />}

        {/* Result panel */}
        {!loading && result && <ResultPanel result={result} />}
      </div>
    </div>
  );
}

// ─── US-URL guidance notice ─────────────────────────────────────────

function UsUrlNotice() {
  return (
    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 ring-1 ring-amber-300/60 dark:ring-amber-800/40 px-3.5 py-3 flex items-start gap-3">
      <div className="size-8 rounded-md bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center shrink-0">
        <MapPin className="size-4 text-amber-700 dark:text-amber-400" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-[12px] font-bold text-amber-900 dark:text-amber-200 leading-tight">
          Only aliexpress.com URLs are accepted
        </p>
        <p className="text-[11px] text-amber-800/85 dark:text-amber-200/80 leading-relaxed">
          If your link is aliexpress.us, open AliExpress and change the
          shipping region from <strong>United States</strong> to{" "}
          <strong>Pakistan</strong>. The same product will then load on
          the .com storefront — copy that URL instead.
        </p>
      </div>
    </div>
  );
}

// ─── Result panel ───────────────────────────────────────────────────

function ResultPanel({ result }: { result: ValidatorResult }) {
  const theme = VERDICT_THEME[result.verdict];
  const Icon = theme.icon;

  return (
    <div className="space-y-4 ap-stagger-in">
      {/* Verdict header */}
      <Card className={`border-2 ${theme.ring} ring-2 shadow-lg`}>
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div
              className={`size-14 rounded-2xl ${theme.bg} text-white flex items-center justify-center shadow-lg ring-2 ring-white/40 shrink-0`}
            >
              <Icon className="size-7" strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Verdict
              </p>
              <h2
                className={`text-2xl font-bold tracking-tight ${theme.text}`}
              >
                {theme.label}
              </h2>
              <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
                {result.summary}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Product preview */}
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="size-24 rounded-lg bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center ring-1 ring-border/40">
              {result.product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.product.imageUrl}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                />
              ) : (
                <Package className="size-8 text-muted-foreground/40" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1 inline-flex items-center gap-2">
                <SourceBadge source={result.product.source} />
                <span className="text-muted-foreground/60 tabular-nums">
                  · {(result.durationMs / 1000).toFixed(1)}s
                </span>
              </p>
              <p className="text-[13px] font-medium leading-snug line-clamp-3">
                {result.product.title}
              </p>
              <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] tabular-nums text-muted-foreground">
                {result.product.priceUsd != null &&
                  result.product.priceUsd > 0 && (
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      ${result.product.priceUsd.toFixed(2)}
                    </span>
                  )}
                {result.product.productUrl && (
                  <a
                    href={result.product.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-violet-700 dark:text-violet-400 hover:underline"
                  >
                    Open on AliExpress
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Flag list */}
      {result.flags.length === 0 ? (
        <Card className="border border-emerald-300/40 dark:border-emerald-700/30 bg-emerald-50/40 dark:bg-emerald-950/15 shadow-none">
          <CardContent className="p-5 flex items-start gap-3">
            <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                No policy issues detected
              </p>
              <p className="text-[12px] text-emerald-800/80 dark:text-emerald-200/80 mt-1 leading-relaxed">
                The product title did not match any encoded Etsy rules
                across Prohibited Items, IP and Trademark, PPE, or
                Creativity Standards. The listing is cleared.
              </p>
              <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70 italic mt-2">
                Note: this check covers the title only. Brand logos and
                character likenesses inside product photos are not
                analysed. Confirm the images do not contain protected
                marks before publishing.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border border-border/60 shadow-none">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {result.flags.length} policy{" "}
                {result.flags.length === 1 ? "flag" : "flags"} raised
              </p>
            </div>
            <div className="space-y-3">
              {result.flags.map((flag, i) => (
                <FlagRow key={i} flag={flag} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-[11px] text-muted-foreground italic">
        Rules sourced from Etsy&apos;s published Prohibited Items, IP and
        Trademark, PPE, and Creativity Standards policies. Updated when
        Etsy revises its policy pages.
      </p>
    </div>
  );
}

function FlagRow({ flag }: { flag: ValidationFlag }) {
  const isBlock = flag.severity === "block";
  const Icon = isBlock ? XCircle : AlertTriangle;
  const colorClasses = isBlock
    ? "bg-rose-50 dark:bg-rose-950/30 ring-rose-300/50 dark:ring-rose-800/40 text-rose-700 dark:text-rose-300"
    : "bg-amber-50 dark:bg-amber-950/30 ring-amber-300/50 dark:ring-amber-800/40 text-amber-700 dark:text-amber-300";

  return (
    <div className={`rounded-xl ring-1 ${colorClasses} p-4`}>
      <div className="flex items-start gap-3">
        <Icon className="size-5 shrink-0 mt-0.5" strokeWidth={2.5} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-tight">
                {flag.label}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mt-0.5">
                {flag.policyClause}
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/60 dark:bg-black/30 ring-1 ring-current/30 shrink-0 tabular-nums">
              Matched: &ldquo;{flag.matchedText}&rdquo;
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/85">
            {flag.explanation}
          </p>
          {flag.suggestion && (
            <p className="text-[12px] leading-relaxed text-foreground/70 italic inline-flex items-start gap-1.5">
              <Info className="size-3 mt-0.5 shrink-0" />
              <span>
                <strong>Recommendation:</strong> {flag.suggestion}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: "com" | "manual" }) {
  if (source === "manual") {
    return (
      <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30">
        Manual entry
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30">
      Aliexpress.com
    </span>
  );
}

// ─── Mode toggle button ─────────────────────────────────────────────

function ModeButton({
  active,
  onClick,
  disabled,
  icon: Icon,
  gradient,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: typeof Link2;
  gradient: string;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative rounded-lg px-3 py-2 text-left transition-all ${
        active
          ? "bg-card shadow-sm ring-1 ring-border/60"
          : "hover:bg-card/60 disabled:opacity-50"
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`size-7 rounded-md flex items-center justify-center ${
            active
              ? `bg-gradient-to-br ${gradient} text-white`
              : "bg-muted text-muted-foreground"
          }`}
        >
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p
            className={`text-[11px] font-bold ${
              active ? "text-foreground" : "text-foreground/70"
            }`}
          >
            {label}
          </p>
          <p className="text-[9px] text-muted-foreground leading-tight">
            {sub}
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Validation cinema — five-stage cinematic loading ───────────────

function ValidationCinema({ stage }: { stage: Stage }) {
  const idx = STAGE_ORDER.indexOf(stage as Exclude<Stage, "idle">);

  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  useEffect(() => {
    startRef.current = Date.now();
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const current = idx >= 0 ? STAGE_META[STAGE_ORDER[idx]] : null;

  return (
    <Card className="border border-border/60 shadow-xl shadow-violet-500/10 overflow-hidden ap-stagger-in">
      <CardContent className="relative p-8 sm:p-10 overflow-hidden">
        {/* Aurora background */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-violet-50/60 via-transparent to-emerald-50/50 dark:from-violet-950/20 dark:via-transparent dark:to-emerald-950/15"
        />
        <div
          aria-hidden
          className="absolute -top-32 -left-20 size-[320px] rounded-full blur-3xl ap-aurora-1 opacity-60"
          style={{
            background:
              "radial-gradient(closest-side, rgba(168,85,247,0.55), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -right-20 size-[360px] rounded-full blur-3xl ap-aurora-2 opacity-60"
          style={{
            background:
              "radial-gradient(closest-side, rgba(16,185,129,0.5), transparent 70%)",
          }}
        />

        <div className="relative flex flex-col items-center text-center">
          {/* Central orb */}
          <div className="relative size-32 sm:size-36 mb-6">
            <div
              aria-hidden
              className="absolute -inset-6 rounded-full bg-gradient-to-br from-violet-400/30 to-emerald-500/30 blur-2xl ap-orb-pulse"
            />
            <div
              aria-hidden
              className="absolute inset-0 rounded-full ring-2 ring-violet-400/30 ap-orb-spin"
              style={{ borderTopColor: "rgba(168,85,247,0.8)" }}
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 size-3 rounded-full bg-violet-500 shadow-lg shadow-violet-500/60" />
            </div>
            <div
              aria-hidden
              className="absolute inset-3 rounded-full ring-2 ring-emerald-400/30 ap-orb-spin"
              style={{
                animationDirection: "reverse",
                animationDuration: "11s",
              }}
            >
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 size-2.5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/60" />
            </div>
            <div className="absolute inset-7 rounded-full bg-gradient-to-br from-violet-600 via-violet-500 to-emerald-500 ring-1 ring-white/30 flex items-center justify-center shadow-2xl shadow-violet-500/40">
              <ShieldCheck className="size-7 text-white" />
            </div>
          </div>

          <p className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-[0.22em] mb-1">
            Validation in progress
          </p>
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight">
            {current ? current.title : "Starting"}
          </h3>
          <p className="text-[13px] text-muted-foreground mt-1.5 max-w-xs">
            {current ? current.sub : "Spinning up the validator"}
          </p>

          <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80 tabular-nums">
            <Loader2 className="size-3 animate-spin" />
            <span>{elapsed}s elapsed · usually 10–15s end to end</span>
          </div>
        </div>

        {/* Stage list */}
        <div className="relative mt-8 grid gap-1.5">
          {STAGE_ORDER.map((s, i) => {
            const done = i < idx;
            const active = i === idx;
            const meta = STAGE_META[s];
            const Icon = meta.icon;
            return (
              <div
                key={s}
                className={`relative flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                  active
                    ? "bg-violet-50/60 dark:bg-violet-950/20 ring-1 ring-violet-500/30"
                    : done
                      ? "bg-emerald-50/40 dark:bg-emerald-950/10"
                      : "bg-muted/20"
                }`}
              >
                <div className="relative shrink-0">
                  {done ? (
                    <div className="size-8 rounded-full bg-emerald-500 ring-1 ring-emerald-600/30 flex items-center justify-center shadow-sm shadow-emerald-500/30">
                      <Check className="size-4 text-white" strokeWidth={3} />
                    </div>
                  ) : active ? (
                    <>
                      <span
                        aria-hidden
                        className="absolute -inset-1 rounded-full bg-violet-400/40 blur-md animate-pulse"
                      />
                      <div className="relative size-8 rounded-full bg-gradient-to-br from-violet-500 to-emerald-500 ring-1 ring-violet-700/30 flex items-center justify-center shadow-md shadow-violet-500/30">
                        <Loader2 className="size-4 text-white animate-spin" />
                      </div>
                    </>
                  ) : (
                    <div className="size-8 rounded-full bg-muted/60 ring-1 ring-border flex items-center justify-center">
                      <Icon className="size-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[13px] font-semibold leading-tight ${
                      done || active
                        ? "text-foreground"
                        : "text-muted-foreground/60"
                    }`}
                  >
                    {meta.title}
                  </p>
                  <p
                    className={`text-[11px] leading-tight mt-0.5 ${
                      done || active
                        ? "text-muted-foreground"
                        : "text-muted-foreground/50"
                    }`}
                  >
                    {meta.sub}
                  </p>
                </div>

                {active && (
                  <div
                    aria-hidden
                    className="absolute inset-y-0 right-0 w-1/3 overflow-hidden rounded-r-xl pointer-events-none"
                  >
                    <div
                      className="absolute inset-y-0 w-full ap-shimmer"
                      style={{
                        background:
                          "linear-gradient(to right, transparent, rgba(168,85,247,0.18), transparent)",
                      }}
                    />
                  </div>
                )}

                <span className="shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground/40 tracking-wider">
                  {String(i + 1).padStart(2, "0")} /{" "}
                  {String(STAGE_ORDER.length).padStart(2, "0")}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Hero banner ────────────────────────────────────────────────────

function HeroBanner() {
  return (
    <div className="relative overflow-hidden shadow-xl shadow-violet-500/15 ap-stagger-in border-b border-white/10">
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a0d2a] via-[#0d1a26] to-[#0d2a1f]" />
      <div
        aria-hidden
        className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl ap-aurora-1"
        style={{
          background:
            "radial-gradient(closest-side, rgba(168,85,247,0.55), rgba(168,85,247,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl ap-aurora-2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(16,185,129,0.55), rgba(16,185,129,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />

      <div className="relative max-w-5xl mx-auto px-7 sm:px-9 py-8 sm:py-10">
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20 shadow-inner">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            Live for the Etsy team
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/90 tracking-[0.16em] uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
            <ShieldCheck className="size-3" />
            Pre-listing policy check
          </span>
        </div>

        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-violet-400/40 to-emerald-500/40 blur-lg ap-orb-pulse"
            />
            <div className="relative size-16 sm:size-[68px] rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-violet-900/40">
              <ShieldCheck className="size-7 sm:size-8 text-white drop-shadow-lg" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.05]">
              Product Validator
            </h1>
            <p className="text-[13px] sm:text-sm text-white/70 mt-1.5 leading-relaxed max-w-2xl">
              Run any AliExpress product through Etsy&apos;s policy rules
              before listing. Catch prohibited items, IP issues, and
              creativity standard violations before they cost the shop a
              strike.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          <FeatureCell
            icon={Link2}
            label="Aliexpress.com URLs"
            sub="Regional storefronts not supported"
          />
          <FeatureCell
            icon={ShieldCheck}
            label="Etsy policy coverage"
            sub="Prohibited · IP · PPE · Creativity"
          />
          <FeatureCell
            icon={Sparkles}
            label="Clear verdict"
            sub="Safe · Review · Do not list"
          />
        </div>
      </div>
    </div>
  );
}

function FeatureCell({
  icon: Icon,
  label,
  sub,
}: {
  icon: typeof Sparkles;
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
        <p className="text-[10px] text-white/55 leading-tight truncate">
          {sub}
        </p>
      </div>
    </div>
  );
}
