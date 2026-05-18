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
  Ban,
  HardHat,
  Palette,
  ChevronRight,
  Clock,
  FileCheck2,
  Type,
  Hash,
  FileText,
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

interface PhotoRiskNote {
  dont: string[];
  do: string[];
}

interface ReframeData {
  listingApproach: string;
  titleGuidance: string[];
  tagGuidance: string[];
  descriptionGuidance: string[];
  avoidWords: string[];
  photoGuidance: PhotoRiskNote;
  visionUsed: boolean;
  modelId: string;
  costUsd: number;
}

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
  reframe: ReframeData | null;
  reframeError: string | null;
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
  | "reframing"
  | "compiling";

/**
 * Minimum visible duration of the loading panel. Bumped to 14s — the
 * reframe pipeline adds a Haiku call (~3-5s) so the cinema needs more
 * room to walk through all six stages without skipping.
 */
const MIN_LOADING_MS = 14_000;

const STAGE_ORDER: Exclude<Stage, "idle">[] = [
  "reading",
  "scanning",
  "checking",
  "reviewing",
  "reframing",
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
  reframing: {
    title: "Generating listing guidance",
    sub: "AI builds strategy + photo regen rules from Etsy policies",
    icon: Sparkles,
  },
  compiling: {
    title: "Compiling verdict",
    sub: "Ordering flags and finalising recommendations",
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
    label: "Listable with care",
  },
  BLOCKED: {
    ring: "ring-rose-500/40",
    bg: "bg-rose-500",
    bgSubtle: "bg-rose-50 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    icon: ShieldX,
    label: "Cannot be listed",
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

  // Drive the visible stage timeline while loading. MIN_LOADING_MS is
  // spread across STAGE_ORDER.length stages — currently 14s ÷ 6 stages
  // = ~2.3s per stage. The stage interval auto-scales if either is
  // bumped, so changes to MIN_LOADING_MS or STAGE_ORDER don't desync
  // the timing from the visible labels.
  useEffect(() => {
    if (!loading) {
      setStage("idle");
      return;
    }
    setStage("reading");
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Spread 6 stages across the 14s minimum window — ~2.3s per step.
    const stepMs = Math.floor(MIN_LOADING_MS / STAGE_ORDER.length);
    STAGE_ORDER.slice(1).forEach((next, i) => {
      timers.push(setTimeout(() => setStage(next), (i + 1) * stepMs));
    });
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  function canSubmit(): boolean {
    if (loading) return false;
    if (mode === "url") return urlInput.trim().length >= 8;
    // Manual check requires both a title and at least one reference photo.
    return manualTitle.trim().length >= 3 && manualImages.length >= 1;
  }

  /**
   * Inline checklist of what is still missing in manual check mode.
   * Surfaced under the run button so the reason the button is disabled
   * is never ambiguous.
   */
  function manualMissing(): string[] {
    const missing: string[] = [];
    if (manualTitle.trim().length < 3) missing.push("product title");
    if (manualImages.length < 1) missing.push("at least one reference photo");
    return missing;
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
        : {
            manualTitle: manualTitle.trim(),
            // Send the uploaded photos so the reframe service can run
            // vision over them and generate specific photo-regen guidance.
            manualImages: manualImages.map((img) => ({
              base64: img.base64,
              mediaType: img.mediaType,
            })),
          };

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
        toast.warning("Listable with care", { description: final.summary });
      } else {
        toast.error("Cannot be listed", { description: final.summary });
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
        {/* Beta-test notice — visible to everyone the validator is
            open to. Removed when the tool graduates to general
            availability. */}
        {!loading && <BetaTestNotice />}

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
                      : "Submit the product manually"}
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
                  label="URL check"
                  sub="aliexpress.com only"
                />
                <ModeButton
                  active={mode === "manual"}
                  onClick={() => setMode("manual")}
                  disabled={loading}
                  icon={PenLine}
                  gradient="from-emerald-500 to-amber-500"
                  label="Manual check"
                  sub="Title + reference photos"
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
                      <span className="text-rose-500">*</span>{" "}
                      <span className="text-muted-foreground/50 font-normal">
                        (1 required, 2 recommended)
                      </span>
                    </Label>
                    <SeoImageUploader
                      images={manualImages}
                      onChange={setManualImages}
                      disabled={loading}
                      maxImages={2}
                    />
                    <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                      AliExpress blocks image downloads. Take screenshots of
                      the product photos and upload them here so the result
                      card shows the product that was validated.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Button
                  type="button"
                  onClick={handleValidate}
                  disabled={!canSubmit()}
                  className="w-full h-12 bg-gradient-to-r from-violet-500 to-emerald-500 hover:opacity-90 text-white font-bold rounded-xl shadow-lg shadow-violet-500/30 disabled:opacity-40"
                >
                  <Sparkles className="size-4 mr-2" />
                  Run validation
                </Button>
                {mode === "manual" && manualMissing().length > 0 && (
                  <p className="text-[11px] text-muted-foreground/80 text-center">
                    Still required: {manualMissing().join(" + ")}.
                  </p>
                )}
              </div>
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

// ─── Beta-test notice ───────────────────────────────────────────────

function BetaTestNotice() {
  return (
    <div className="rounded-xl bg-gradient-to-r from-amber-500/12 via-amber-500/8 to-violet-500/12 ring-1 ring-amber-500/30 px-4 py-3 flex items-start gap-3">
      <div className="size-9 rounded-lg bg-amber-500/20 ring-1 ring-amber-500/40 flex items-center justify-center shrink-0">
        <Sparkles className="size-4 text-amber-700 dark:text-amber-400" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-[12px] font-bold text-amber-900 dark:text-amber-200 leading-tight">
          Beta version · EM team and Etsy partners are testing this tool
        </p>
        <p className="text-[11px] text-amber-800/85 dark:text-amber-200/80 leading-relaxed">
          The rule set and AI listing guidance are new. If a verdict
          looks wrong, a product gets blocked unfairly, or the
          generated strategy doesn&apos;t fit one of your niches —
          share the AliExpress URL + a note with the CEO so the
          rules can be tuned.
        </p>
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
//
// Composed from four sections, each a self-contained component:
//   1. VerdictHero        — gradient banner sized to the verdict
//   2. CheckedProductCard — what was validated (image + title + source)
//   3. PolicyMatrix       — 4-up grid showing status of each Etsy policy
//   4. Findings / Cleared — flag cards or success confirmation
// Footer cites the rule source.

const POLICY_CATEGORIES: Array<{
  key: "prohibited" | "ip" | "ppe" | "creativity";
  label: string;
  shortLabel: string;
  icon: typeof Ban;
  /** Policy fields on the flag object that belong in this bucket. */
  policies: string[];
}> = [
  {
    key: "prohibited",
    label: "Prohibited items",
    shortLabel: "Prohibited",
    icon: Ban,
    policies: [
      "prohibited",
      "hate",
      "adult",
      "animals",
      "drugs",
      "weapons",
      "violence",
    ],
  },
  {
    key: "ip",
    label: "IP & trademark",
    shortLabel: "IP",
    icon: Scale,
    policies: ["ip"],
  },
  {
    key: "ppe",
    label: "PPE policy",
    shortLabel: "PPE",
    icon: HardHat,
    policies: ["ppe"],
  },
  {
    key: "creativity",
    label: "Creativity standards",
    shortLabel: "Creativity",
    icon: Palette,
    policies: ["creativity"],
  },
];

type CategoryStatus = "pass" | "review" | "block";

function categoryStatus(
  flags: ValidationFlag[],
  policies: string[],
): { status: CategoryStatus; count: number } {
  const matches = flags.filter((f) => policies.includes(f.policy));
  if (matches.length === 0) return { status: "pass", count: 0 };
  const status: CategoryStatus = matches.some((f) => f.severity === "block")
    ? "block"
    : "review";
  return { status, count: matches.length };
}

function ResultPanel({ result }: { result: ValidatorResult }) {
  return (
    <div className="space-y-4 ap-stagger-in">
      <VerdictHero result={result} />
      <CheckedProductCard result={result} />
      <PolicyMatrix flags={result.flags} verdict={result.verdict} />
      {result.flags.length > 0 ? (
        <FindingsSection flags={result.flags} />
      ) : (
        <ClearedConfirmation />
      )}
      {/* AI reframe — only shown for REVIEW verdicts, never for hard
          blocks (no reframe possible) or SAFE (no reframe needed).
          When the reframe step failed (timeout, Anthropic 5xx,
          malformed JSON), render a small fallback note so the user
          isn't staring at a silent gap. */}
      {result.verdict === "REVIEW" && result.reframe && (
        <ReframePanel reframe={result.reframe} />
      )}
      {result.verdict === "REVIEW" &&
        !result.reframe &&
        result.reframeError && (
          <ReframeFallback message={result.reframeError} />
        )}
      <RuleSourceFooter />
    </div>
  );
}

// ─── Reframe panel (AI-generated Etsy-safe listing guidance) ────────

function ReframePanel({ reframe }: { reframe: ReframeData }) {
  const hasAnyGuidance =
    reframe.listingApproach.trim().length > 0 ||
    reframe.titleGuidance.length > 0 ||
    reframe.tagGuidance.length > 0 ||
    reframe.descriptionGuidance.length > 0;

  return (
    <div className="space-y-4">
      {/* Strategy header */}
      <div className="relative overflow-hidden rounded-2xl border border-violet-300/40 dark:border-violet-700/30 bg-gradient-to-br from-violet-50/70 via-violet-50/30 to-emerald-50/40 dark:from-violet-950/30 dark:via-violet-950/15 dark:to-emerald-950/15">
        <div className="px-5 py-4 flex items-start gap-4">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-1.5 rounded-2xl bg-violet-500/30 blur-md"
            />
            <div className="relative size-11 rounded-2xl bg-gradient-to-br from-violet-500 to-emerald-500 ring-2 ring-white/50 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Sparkles className="size-5 text-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700 dark:text-violet-300">
              How to list this on Etsy
            </p>
            <h3 className="text-base font-bold text-foreground leading-tight mt-0.5">
              Listing guidance for a flagged product
            </h3>
            <p className="text-[11.5px] text-foreground/70 mt-1 leading-relaxed">
              Follow the direction and rules below when writing the
              title, tags, and description (or when running this product
              through SEO Autopilot). Avoid the listed words anywhere on
              the listing. Use the photo guidance during the identity
              regeneration pass.
            </p>
          </div>
        </div>
      </div>

      {/* Listing approach (overall direction) */}
      {reframe.listingApproach.trim().length > 0 && (
        <Card className="border border-violet-300/30 dark:border-violet-700/30 bg-violet-50/30 dark:bg-violet-950/15 shadow-none">
          <div className="px-5 pt-4 pb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
              Listing approach
            </p>
            <p className="text-[10px] font-semibold text-violet-700/70 dark:text-violet-300/70 mt-0.5">
              The overall direction to take with this product
            </p>
          </div>
          <CardContent className="px-5 pb-5 pt-2">
            <p className="text-[13px] leading-relaxed text-foreground/90">
              {reframe.listingApproach}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Guidance: title / tags / description */}
      {hasAnyGuidance && (
        <Card className="border border-border/60 shadow-none">
          <div className="px-5 pt-4 pb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Writing rules
            </p>
            <p className="text-[10px] font-semibold text-muted-foreground/70 mt-0.5">
              Follow these rules when the team (or SEO Autopilot) writes
              the actual listing content
            </p>
          </div>
          <CardContent className="px-5 pb-5 pt-2 space-y-4">
            {reframe.titleGuidance.length > 0 && (
              <GuidanceGroup
                heading="Title"
                icon={Type}
                accent="violet"
                bullets={reframe.titleGuidance}
              />
            )}
            {reframe.tagGuidance.length > 0 && (
              <GuidanceGroup
                heading="Tags"
                icon={Hash}
                accent="emerald"
                bullets={reframe.tagGuidance}
              />
            )}
            {reframe.descriptionGuidance.length > 0 && (
              <GuidanceGroup
                heading="Description"
                icon={FileText}
                accent="amber"
                bullets={reframe.descriptionGuidance}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Avoid words */}
      {reframe.avoidWords.length > 0 && (
        <Card className="border border-rose-300/40 dark:border-rose-700/30 bg-rose-50/40 dark:bg-rose-950/15 shadow-none">
          <div className="px-5 pt-4 pb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">
              Avoid these exact words
            </p>
            <p className="text-[10px] font-semibold text-rose-700/70 dark:text-rose-300/70 mt-0.5">
              Do not include in title, tags, description, or anywhere on
              the listing
            </p>
          </div>
          <CardContent className="px-5 pb-5 pt-2">
            <div className="flex flex-wrap gap-1.5">
              {reframe.avoidWords.map((word, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1.5 rounded-md bg-rose-500/15 text-rose-800 dark:text-rose-200 ring-1 ring-rose-500/30 line-through decoration-rose-500/70 decoration-1.5"
                >
                  <Ban className="size-3 no-underline" strokeWidth={2.5} />
                  {word}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Photo regen guidance */}
      {(reframe.photoGuidance.dont.length > 0 ||
        reframe.photoGuidance.do.length > 0) && (
        <Card className="border border-amber-300/40 dark:border-amber-700/30 bg-amber-50/30 dark:bg-amber-950/10 shadow-none">
          <div className="px-5 pt-4 pb-2 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-200">
                Photo regeneration guidance
              </p>
              <p className="text-[10px] font-semibold text-amber-800/70 dark:text-amber-200/70 mt-0.5">
                For the identity-shot pass before listing on Etsy
              </p>
            </div>
            {reframe.visionUsed && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30">
                <Eye className="size-2.5" />
                Vision analysed
              </span>
            )}
          </div>
          <CardContent className="px-5 pb-5 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {reframe.photoGuidance.dont.length > 0 && (
                <div className="rounded-lg bg-rose-500/8 ring-1 ring-rose-500/25 p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 inline-flex items-center gap-1">
                    <XCircle className="size-3" strokeWidth={3} />
                    Do not recreate
                  </p>
                  <ul className="space-y-1.5">
                    {reframe.photoGuidance.dont.map((item, i) => (
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
              {reframe.photoGuidance.do.length > 0 && (
                <div className="rounded-lg bg-emerald-500/8 ring-1 ring-emerald-500/25 p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3" strokeWidth={3} />
                    Use instead
                  </p>
                  <ul className="space-y-1.5">
                    {reframe.photoGuidance.do.map((item, i) => (
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Guidance group (title / tag / description rule list) ───────────

function GuidanceGroup({
  heading,
  icon: Icon,
  accent,
  bullets,
}: {
  heading: string;
  icon: typeof Type;
  accent: "violet" | "emerald" | "amber";
  bullets: string[];
}) {
  const theme = {
    violet: {
      iconBg:
        "bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-violet-500/30",
      bullet: "bg-violet-500",
      headingText: "text-violet-700 dark:text-violet-300",
    },
    emerald: {
      iconBg:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
      bullet: "bg-emerald-500",
      headingText: "text-emerald-700 dark:text-emerald-300",
    },
    amber: {
      iconBg:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
      bullet: "bg-amber-500",
      headingText: "text-amber-700 dark:text-amber-300",
    },
  }[accent];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div
          className={`size-7 rounded-lg ring-1 flex items-center justify-center ${theme.iconBg}`}
        >
          <Icon className="size-3.5" />
        </div>
        <p
          className={`text-[11px] font-bold uppercase tracking-[0.16em] ${theme.headingText}`}
        >
          {heading}
        </p>
      </div>
      <ul className="space-y-1.5 pl-9">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="text-[12.5px] leading-relaxed text-foreground/85 flex gap-2 items-start"
          >
            <span
              className={`mt-1.5 size-1 rounded-full shrink-0 ${theme.bullet}`}
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Verdict hero ───────────────────────────────────────────────────

function VerdictHero({ result }: { result: ValidatorResult }) {
  const theme = VERDICT_THEME[result.verdict];
  const Icon = theme.icon;

  const heroBg = {
    SAFE: "from-emerald-500/15 via-emerald-500/5 to-transparent",
    REVIEW: "from-amber-500/15 via-amber-500/5 to-transparent",
    BLOCKED: "from-rose-500/15 via-rose-500/5 to-transparent",
  }[result.verdict];

  const accentRing = {
    SAFE: "ring-emerald-500/30",
    REVIEW: "ring-amber-500/30",
    BLOCKED: "ring-rose-500/30",
  }[result.verdict];

  const iconGlow = {
    SAFE: "shadow-emerald-500/40",
    REVIEW: "shadow-amber-500/40",
    BLOCKED: "shadow-rose-500/40",
  }[result.verdict];

  const blockCount = result.flags.filter((f) => f.severity === "block").length;
  const reviewCount = result.flags.filter((f) => f.severity === "review").length;

  return (
    <Card
      className={`relative overflow-hidden border-2 ${accentRing} ring-1 shadow-xl`}
    >
      <div
        aria-hidden
        className={`absolute inset-0 bg-gradient-to-br ${heroBg} pointer-events-none`}
      />
      <CardContent className="relative p-6 sm:p-7">
        <div className="flex items-start gap-5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className={`absolute -inset-2 rounded-3xl ${theme.bg} opacity-30 blur-xl`}
            />
            <div
              className={`relative size-16 sm:size-[68px] rounded-2xl ${theme.bg} text-white flex items-center justify-center ring-2 ring-white/50 shadow-2xl ${iconGlow}`}
            >
              <Icon className="size-8" strokeWidth={2.4} />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/80">
                Validation verdict
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/70 tabular-nums">
                <Clock className="size-3" />
                {(result.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
            <h2
              className={`text-2xl sm:text-[28px] font-bold tracking-tight leading-[1.1] ${theme.text}`}
            >
              {theme.label}
            </h2>
            <p className="text-[13px] text-foreground/75 mt-2 leading-relaxed max-w-2xl">
              {result.summary}
            </p>

            {/* Outcome metrics */}
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <MetricChip
                tone={result.verdict === "SAFE" ? "good" : "neutral"}
                icon={FileCheck2}
                label={`${POLICY_CATEGORIES.length} policies checked`}
              />
              {blockCount > 0 && (
                <MetricChip
                  tone="bad"
                  icon={XCircle}
                  label={`${blockCount} blocking ${blockCount === 1 ? "issue" : "issues"}`}
                />
              )}
              {reviewCount > 0 && (
                <MetricChip
                  tone="warn"
                  icon={AlertTriangle}
                  label={`${reviewCount} review ${reviewCount === 1 ? "flag" : "flags"}`}
                />
              )}
              {result.flags.length === 0 && (
                <MetricChip
                  tone="good"
                  icon={CheckCircle2}
                  label="No policy flags"
                />
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricChip({
  tone,
  icon: Icon,
  label,
}: {
  tone: "good" | "warn" | "bad" | "neutral";
  icon: typeof FileCheck2;
  label: string;
}) {
  const toneClasses = {
    good: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
    warn: "bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-500/30",
    bad: "bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-500/30",
    neutral:
      "bg-muted/60 text-muted-foreground ring-border/60",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ring-1 ${toneClasses}`}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

// ─── Checked product card ───────────────────────────────────────────

function CheckedProductCard({ result }: { result: ValidatorResult }) {
  return (
    <Card className="border border-border/60 shadow-none overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Product validated
        </p>
        <SourceBadge source={result.product.source} />
      </div>
      <CardContent className="px-5 pb-5 pt-2">
        <div className="flex items-start gap-4">
          <div className="size-24 sm:size-28 rounded-xl bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center ring-1 ring-border/50">
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
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-[14px] font-semibold leading-snug text-foreground/95">
              {result.product.title}
            </p>
            <div className="flex items-center gap-3 flex-wrap text-[11px]">
              {result.product.priceUsd != null &&
                result.product.priceUsd > 0 && (
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    AliExpress price ${result.product.priceUsd.toFixed(2)}
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
  );
}

// ─── Policy coverage matrix ─────────────────────────────────────────

function PolicyMatrix({
  flags,
  verdict,
}: {
  flags: ValidationFlag[];
  verdict: Verdict;
}) {
  return (
    <Card className="border border-border/60 shadow-none">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Policy coverage
        </p>
        <p className="text-[10px] font-semibold text-muted-foreground/70">
          {verdict === "SAFE"
            ? "All four policies cleared"
            : "Status by policy area"}
        </p>
      </div>
      <CardContent className="px-5 pb-5 pt-2">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {POLICY_CATEGORIES.map((cat) => {
            const { status, count } = categoryStatus(flags, cat.policies);
            return (
              <PolicyCell
                key={cat.key}
                label={cat.label}
                shortLabel={cat.shortLabel}
                icon={cat.icon}
                status={status}
                count={count}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyCell({
  label,
  icon: Icon,
  status,
  count,
}: {
  label: string;
  shortLabel: string;
  icon: typeof Ban;
  status: CategoryStatus;
  count: number;
}) {
  const theme = {
    pass: {
      iconBg:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30",
      pillBg:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
      pillLabel: "Cleared",
      cardBg: "bg-emerald-50/40 dark:bg-emerald-950/15 ring-emerald-500/15",
      PillIcon: CheckCircle2,
    },
    review: {
      iconBg:
        "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/30",
      pillBg:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
      pillLabel: count === 1 ? "1 review" : `${count} reviews`,
      cardBg: "bg-amber-50/50 dark:bg-amber-950/15 ring-amber-500/20",
      PillIcon: AlertTriangle,
    },
    block: {
      iconBg:
        "bg-rose-500/15 text-rose-700 dark:text-rose-400 ring-rose-500/30",
      pillBg:
        "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30",
      pillLabel: count === 1 ? "1 block" : `${count} blocks`,
      cardBg: "bg-rose-50/50 dark:bg-rose-950/15 ring-rose-500/20",
      PillIcon: XCircle,
    },
  }[status];

  const PillIcon = theme.PillIcon;

  return (
    <div
      className={`rounded-xl ring-1 p-3 flex items-center gap-3 ${theme.cardBg}`}
    >
      <div
        className={`size-9 rounded-lg ring-1 flex items-center justify-center shrink-0 ${theme.iconBg}`}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[11px] font-bold leading-tight truncate">{label}</p>
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ring-1 ${theme.pillBg}`}
        >
          <PillIcon className="size-2.5" strokeWidth={3} />
          {theme.pillLabel}
        </span>
      </div>
    </div>
  );
}

// ─── Findings section (flags present) ───────────────────────────────

function FindingsSection({ flags }: { flags: ValidationFlag[] }) {
  const blocks = flags.filter((f) => f.severity === "block");
  const reviews = flags.filter((f) => f.severity === "review");

  return (
    <Card className="border border-border/60 shadow-none">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Findings
        </p>
        <p className="text-[10px] font-semibold text-muted-foreground/70 tabular-nums">
          {flags.length} {flags.length === 1 ? "flag" : "flags"} ·{" "}
          {blocks.length} blocking · {reviews.length} review
        </p>
      </div>
      <CardContent className="px-5 pb-5 pt-2 space-y-3">
        {flags.map((flag, i) => (
          <FlagCard key={i} flag={flag} />
        ))}
      </CardContent>
    </Card>
  );
}

function FlagCard({ flag }: { flag: ValidationFlag }) {
  const isBlock = flag.severity === "block";
  const Icon = isBlock ? XCircle : AlertTriangle;

  const theme = isBlock
    ? {
        wrap: "ring-rose-300/50 dark:ring-rose-800/40",
        bar: "bg-rose-500",
        iconBg: "bg-rose-500 text-white",
        severityPill:
          "bg-rose-500 text-white",
        severityLabel: "Blocking",
        matchedBg:
          "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 ring-rose-300/50 dark:ring-rose-800/40",
        suggestionBg:
          "bg-rose-50/60 dark:bg-rose-950/20 text-rose-800/90 dark:text-rose-200/80",
      }
    : {
        wrap: "ring-amber-300/50 dark:ring-amber-800/40",
        bar: "bg-amber-500",
        iconBg: "bg-amber-500 text-white",
        severityPill:
          "bg-amber-500 text-white",
        severityLabel: "Review",
        matchedBg:
          "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 ring-amber-300/50 dark:ring-amber-800/40",
        suggestionBg:
          "bg-amber-50/60 dark:bg-amber-950/20 text-amber-800/90 dark:text-amber-200/80",
      };

  return (
    <div
      className={`relative rounded-xl ring-1 overflow-hidden bg-card ${theme.wrap}`}
    >
      {/* Severity color bar */}
      <div
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${theme.bar}`}
      />

      <div className="p-4 pl-5 space-y-3">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div
            className={`size-9 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${theme.iconBg}`}
          >
            <Icon className="size-4" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span
                className={`inline-flex items-center text-[9px] font-bold uppercase tracking-[0.16em] px-2 py-0.5 rounded-full ${theme.severityPill}`}
              >
                {theme.severityLabel}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                {flag.policyClause}
              </span>
            </div>
            <p className="text-[14px] font-bold leading-tight">{flag.label}</p>
          </div>
        </div>

        {/* Matched text */}
        <div
          className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-md ring-1 ${theme.matchedBg}`}
        >
          <span className="text-[9px] uppercase tracking-wider opacity-70 font-sans font-bold">
            Matched
          </span>
          <span className="font-semibold">&ldquo;{flag.matchedText}&rdquo;</span>
        </div>

        {/* Explanation */}
        <p className="text-[12.5px] leading-relaxed text-foreground/85">
          {flag.explanation}
        </p>

        {/* Recommendation */}
        {flag.suggestion && (
          <div
            className={`rounded-lg px-3 py-2.5 flex items-start gap-2 ${theme.suggestionBg}`}
          >
            <ChevronRight className="size-3.5 mt-0.5 shrink-0" />
            <p className="text-[12px] leading-relaxed">
              <span className="font-bold uppercase text-[10px] tracking-wider opacity-80 mr-1.5">
                Recommendation
              </span>
              {flag.suggestion}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cleared confirmation (no flags) ────────────────────────────────

function ClearedConfirmation() {
  return (
    <Card className="border border-emerald-300/40 dark:border-emerald-700/30 bg-gradient-to-br from-emerald-50/60 via-emerald-50/30 to-transparent dark:from-emerald-950/25 dark:via-emerald-950/10 shadow-none overflow-hidden">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-1.5 rounded-2xl bg-emerald-500/30 blur-md"
            />
            <div className="relative size-12 rounded-2xl bg-emerald-500 ring-2 ring-white/60 dark:ring-emerald-200/20 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <CheckCircle2 className="size-6 text-white" strokeWidth={2.4} />
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[15px] font-bold text-emerald-900 dark:text-emerald-100 leading-tight">
              No policy issues detected
            </p>
            <p className="text-[12.5px] text-emerald-900/80 dark:text-emerald-100/80 leading-relaxed">
              The product title did not match any encoded Etsy rules across
              Prohibited Items, IP and Trademark, PPE, or Creativity
              Standards. The listing is cleared for publication.
            </p>
            <div className="rounded-lg bg-white/60 dark:bg-emerald-950/30 ring-1 ring-emerald-500/20 px-3 py-2.5 mt-2 flex items-start gap-2.5">
              <Info className="size-3.5 text-emerald-700 dark:text-emerald-300 mt-0.5 shrink-0" />
              <p className="text-[11.5px] leading-relaxed text-emerald-900/85 dark:text-emerald-100/85">
                <span className="font-bold">Visual review still required.</span>{" "}
                This check covers the title only. Brand logos and character
                likenesses inside the product photos are not analysed.
                Inspect the images and confirm they do not contain protected
                marks before publishing on Etsy.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Rule source footer ─────────────────────────────────────────────

// ─── Reframe fallback (shown when AI reframe failed) ────────────────

function ReframeFallback({ message }: { message: string }) {
  return (
    <Card className="border border-amber-300/40 dark:border-amber-700/30 bg-amber-50/40 dark:bg-amber-950/15 shadow-none">
      <CardContent className="p-5 flex items-start gap-3">
        <div className="size-9 rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center shrink-0">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-[13px] font-bold text-amber-900 dark:text-amber-200 leading-tight">
            AI listing guidance unavailable for this run
          </p>
          <p className="text-[12px] text-amber-800/85 dark:text-amber-200/80 leading-relaxed">
            The verdict and policy flags above are accurate, but the
            Etsy-safe listing strategy did not generate this time. Use
            the recommendations under each flag in Findings, or retry
            the validation.
          </p>
          <p className="text-[10px] text-amber-700/60 dark:text-amber-300/60 italic pt-1">
            Reason: {message.slice(0, 160)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleSourceFooter() {
  return (
    <p className="text-center text-[11px] text-muted-foreground italic px-4">
      Rules sourced from Etsy&apos;s published Prohibited Items, IP and
      Trademark, PPE, and Creativity Standards policies. Updated when
      Etsy revises its policy pages.
    </p>
  );
}

function SourceBadge({ source }: { source: "com" | "manual" }) {
  if (source === "manual") {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30">
        <PenLine className="size-2.5" />
        Manual check
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30">
      <Link2 className="size-2.5" />
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
          <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-amber-500/25 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-amber-300/40 shadow-inner shadow-amber-500/20">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-80" />
              <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
            </span>
            Beta · EM team + partners
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
            sub="Safe · Review · Flagged"
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
