"use client";

import { useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

/**
 * Product Validator — paste an AliExpress URL, get an Etsy policy verdict.
 *
 * UI shape:
 *   1. Hero — purple/violet (different from Hunter's cool palette).
 *   2. Input card with two modes:
 *      - URL paste (default; works for .com + .us)
 *      - Manual entry (title + optional image URL — for .us URLs
 *        that auto-fetch can't load)
 *   3. Result panel — verdict pill + product preview + flag list with
 *      per-rule policy citations.
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
    source: "com" | "us" | "manual";
  };
  fetchPath: "ds_api" | "html_scrape" | "manual";
  durationMs: number;
}

type InputMode = "url" | "manual";

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
    label: "Safe to list",
  },
  REVIEW: {
    ring: "ring-amber-500/40",
    bg: "bg-amber-500",
    bgSubtle: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    icon: ShieldAlert,
    label: "Review carefully",
  },
  BLOCKED: {
    ring: "ring-rose-500/40",
    bg: "bg-rose-500",
    bgSubtle: "bg-rose-50 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    icon: ShieldX,
    label: "Don't list",
  },
};

export function ProductValidatorView() {
  const [mode, setMode] = useState<InputMode>("url");
  const [urlInput, setUrlInput] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidatorResult | null>(null);

  function canSubmit(): boolean {
    if (loading) return false;
    if (mode === "url") return urlInput.trim().length >= 8;
    return manualTitle.trim().length >= 3;
  }

  /**
   * Handle URL input changes. If the user pastes an aliexpress.us URL,
   * auto-switch to manual mode immediately — server-side scraping for
   * .us URLs is blocked by AE's Cloudflare and the user would otherwise
   * wait ~60s for 5 attempts to fail before being told to enter manually.
   * Skipping that wait is the difference between "tool works" and
   * "tool wastes my time."
   */
  function handleUrlChange(value: string) {
    setUrlInput(value);
    const isUsUrl =
      /aliexpress\.us/i.test(value) && !/aliexpress\.com/i.test(value);
    if (isUsUrl && mode === "url" && value.length >= 20) {
      setMode("manual");
      toast.info("Switched to manual entry", {
        description:
          "aliexpress.us URLs can't auto-load (Cloudflare blocks our server). Paste the title from the AE page below.",
        duration: 6000,
      });
    }
  }

  async function handleValidate(): Promise<void> {
    if (!canSubmit()) return;
    setLoading(true);
    setResult(null);

    const body =
      mode === "url"
        ? { url: urlInput.trim() }
        : {
            manualTitle: manualTitle.trim(),
            manualImageUrl: manualImageUrl.trim() || null,
            // Still pass URL if user has it, so the result card can
            // link back to the AE page.
            url: urlInput.trim() || undefined,
          };

    try {
      const res = await fetch("/api/product-validator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = await res.json().catch(() => ({}));
        const msg = respBody?.error ?? `Failed (${res.status})`;
        // If URL auto-fetch failed (502), gently nudge to manual mode
        // and carry the URL over as context.
        if (mode === "url" && res.status === 502) {
          setMode("manual");
          toast.error("Couldn't auto-load — switched to manual entry", {
            description:
              "Paste the product title from the AE page and click Validate.",
            duration: 7000,
          });
          return;
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as ValidatorResult;
      setResult(data);
      // Toast colour matches verdict
      if (data.verdict === "SAFE") {
        toast.success("Safe to list", { description: data.summary });
      } else if (data.verdict === "REVIEW") {
        toast.warning("Review before listing", { description: data.summary });
      } else {
        toast.error("Don't list this", { description: data.summary });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast.error("Validation failed", { description: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative pb-12">
      {/* Full-bleed hero — violet/emerald gradient (policy/safety vibe) */}
      <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
        <HeroBanner />
      </div>

      <div className="max-w-5xl mx-auto space-y-5">
        {/* Input card */}
        <Card className="border border-border/60 shadow-none">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 ring-1 ring-violet-500/30 flex items-center justify-center shadow shadow-violet-500/30">
                <ShieldCheck className="size-5 text-white" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-600 dark:text-violet-400">
                  Pre-listing safety check
                </p>
                <h3 className="text-[16px] font-bold leading-tight">
                  {mode === "url"
                    ? "Paste an AliExpress product URL"
                    : "Enter the product title manually"}
                </h3>
              </div>
            </div>

            {/* Mode toggle — URL vs Manual */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-1 ring-1 ring-border/40">
              <ModeButton
                active={mode === "url"}
                onClick={() => setMode("url")}
                disabled={loading}
                icon={Link2}
                gradient="from-violet-500 to-emerald-500"
                label="Paste URL"
                sub=".com or .us"
              />
              <ModeButton
                active={mode === "manual"}
                onClick={() => setMode("manual")}
                disabled={loading}
                icon={PenLine}
                gradient="from-emerald-500 to-amber-500"
                label="Manual entry"
                sub="If auto-fetch fails"
              />
            </div>

            {/* URL mode input */}
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
                <p className="text-[11px] text-muted-foreground/80">
                  Best for <strong>aliexpress.com</strong> URLs (auto-fetches
                  the title). If you paste an <strong>aliexpress.us</strong>{" "}
                  URL we&apos;ll auto-switch to manual entry — Cloudflare
                  blocks server-side scraping for that domain.
                </p>
              </>
            )}

            {/* Manual mode inputs */}
            {mode === "manual" && (
              <div className="space-y-3">
                {/* Quick action: if user has a source URL, give them
                    a one-click "Open AE page" button so they can grab
                    the title in 2 clicks (open page → copy title).
                    Speeds the typical .us workflow dramatically. */}
                {urlInput.trim().length >= 10 && (
                  <div className="rounded-lg bg-violet-500/10 ring-1 ring-violet-500/30 px-3 py-2.5 flex items-center gap-3">
                    <div className="size-8 rounded-md bg-violet-500/20 ring-1 ring-violet-500/30 flex items-center justify-center shrink-0">
                      <Link2 className="size-4 text-violet-700 dark:text-violet-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-violet-800 dark:text-violet-200 leading-tight">
                        Step 1: open the AE page and copy the title
                      </p>
                      <p className="text-[10px] text-violet-700/70 dark:text-violet-300/70 truncate">
                        {urlInput.trim().slice(0, 80)}
                        {urlInput.trim().length > 80 ? "…" : ""}
                      </p>
                    </div>
                    <a
                      href={urlInput.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-bold transition-colors"
                    >
                      Open page
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label
                    htmlFor="manual-title"
                    className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground"
                  >
                    {urlInput.trim().length >= 10
                      ? "Step 2: paste the product title here "
                      : "Product title "}
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
                    placeholder="Copy-paste the product title exactly as it appears on AE"
                    disabled={loading}
                    maxLength={500}
                    autoFocus
                    className="h-10 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="manual-image"
                      className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground"
                    >
                      Image URL{" "}
                      <span className="text-muted-foreground/50 font-normal">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="manual-image"
                      type="text"
                      value={manualImageUrl}
                      onChange={(e) => setManualImageUrl(e.target.value)}
                      placeholder="https://..."
                      disabled={loading}
                      className="h-10 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="manual-url"
                      className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground"
                    >
                      Source URL{" "}
                      <span className="text-muted-foreground/50 font-normal">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="manual-url"
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://www.aliexpress.us/item/..."
                      disabled={loading}
                      className="h-10 text-sm"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground/80">
                  Only the <strong>title</strong> is checked against Etsy
                  policy rules. Image URL + source URL just decorate the
                  result card.
                </p>
              </div>
            )}

            <Button
              type="button"
              onClick={handleValidate}
              disabled={!canSubmit()}
              className="w-full h-12 bg-gradient-to-r from-violet-500 to-emerald-500 hover:opacity-90 text-white font-bold rounded-xl shadow-lg shadow-violet-500/30 disabled:opacity-40"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Checking Etsy policies…
                </>
              ) : (
                <>
                  <Sparkles className="size-4 mr-2" />
                  Validate against Etsy policies
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Result panel */}
        {result && <ResultPanel result={result} />}
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
                No policy issues caught
              </p>
              <p className="text-[12px] text-emerald-800/80 dark:text-emerald-200/80 mt-1 leading-relaxed">
                The product title didn&apos;t match any of our encoded Etsy
                rules (prohibited items, IP, PPE, creativity standards).
                You&apos;re clear to list.
              </p>
              <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70 italic mt-2">
                Note: the validator only checks the title. Visual policy
                checks (brand logos in images, character likenesses) aren&apos;t
                covered — give the photos a quick visual scan before listing.
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
                {result.flags.length === 1 ? "flag" : "flags"} found
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

      {/* Footer tip */}
      <p className="text-center text-[11px] text-muted-foreground italic">
        Powered by Etsy&apos;s public Prohibited Items, IP, PPE, and
        Creativity Standards policies. Rules updated when Etsy revises
        its policy pages.
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
                <strong>Try this:</strong> {flag.suggestion}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: "com" | "us" | "manual" }) {
  if (source === "manual") {
    return (
      <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30">
        Manual entry
      </span>
    );
  }
  if (source === "us") {
    return (
      <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/30">
        Aliexpress.us
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
            Live · Free for the team
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/90 tracking-[0.16em] uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
            <ShieldCheck className="size-3" />
            Pre-listing check
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
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          <FeatureCell
            icon={Link2}
            label=".com + .us"
            sub="Both URLs work"
          />
          <FeatureCell
            icon={ShieldCheck}
            label="Etsy policies"
            sub="Prohibited · IP · PPE · Creativity"
          />
          <FeatureCell
            icon={Sparkles}
            label="Instant verdict"
            sub="SAFE · REVIEW · BLOCKED"
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
