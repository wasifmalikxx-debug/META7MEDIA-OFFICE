"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  ExternalLink,
  Heart,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Check,
  X,
  ShoppingBag,
  Star,
  DollarSign,
  Package,
  Link2,
  PenLine,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Reverse Hunt section — lives inside the Product Hunter hub now.
 *
 * Paste an AliExpress URL → fetch product → check Etsy demand → verdict
 * + projected margin. Same backend as before (POST /api/reverse-hunt).
 *
 * Was previously a standalone /reverse-hunt page; merged into Product
 * Hunter on May 16 so all hunting tools live in one place.
 */

interface AliProductLite {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceMin: number;
  priceMax: number;
  currency: string;
  rating?: number;
  orderCount?: number;
  shopName?: string;
}

interface EtsyDemandLite {
  searchKeyword: string;
  totalListings: number;
  avgTopPrice: number;
  avgTopFavorites: number;
  topListings: Array<{
    title: string;
    price: number;
    favorites: number;
    listingId: number;
    url?: string;
  }>;
}

type Verdict = "STRONG_YES" | "YES" | "MAYBE" | "NO";

interface HuntResult {
  aliProduct: AliProductLite;
  etsyDemand: EtsyDemandLite;
  verdict: Verdict;
  verdictLabel: string;
  reasons: string[];
  recommendedEtsyPrice: number;
  estimatedMarginUsd: number;
  estimatedMarginPct: number;
  totalCostUsd: number;
  durationMs: number;
}

const VERDICT_THEME: Record<
  Verdict,
  { ring: string; bg: string; text: string; icon: typeof Check }
> = {
  STRONG_YES: {
    ring: "ring-emerald-500/40",
    bg: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    icon: Check,
  },
  YES: {
    ring: "ring-sky-500/40",
    bg: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-300",
    icon: TrendingUp,
  },
  MAYBE: {
    ring: "ring-amber-500/40",
    bg: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    icon: TrendingDown,
  },
  NO: {
    ring: "ring-rose-500/40",
    bg: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-300",
    icon: X,
  },
};

type HuntMode = "url" | "manual";

export function ReverseHuntSection({ isCeo }: { isCeo: boolean }) {
  const [mode, setMode] = useState<HuntMode>("url");
  const [input, setInput] = useState("");
  // Manual mode state (used when AE.us URL won't auto-fetch)
  const [manualTitle, setManualTitle] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [manualSourceUrl, setManualSourceUrl] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HuntResult | null>(null);

  function canSubmit(): boolean {
    if (loading) return false;
    if (mode === "url") return input.trim().length >= 8;
    return manualTitle.trim().length >= 3 && Number(manualPrice) > 0;
  }

  async function handleHunt() {
    if (!canSubmit()) return;
    setLoading(true);
    setResult(null);

    // Build request body for the chosen mode
    const body =
      mode === "url"
        ? { input: input.trim() }
        : {
            manualProduct: {
              title: manualTitle.trim(),
              priceUsd: Number(manualPrice),
              imageUrl: manualImageUrl.trim() || null,
              productUrl: manualSourceUrl.trim() || null,
            },
          };

    try {
      const res = await fetch("/api/reverse-hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error(
            "AliExpress not connected — use the Connect button above.",
          );
        }
        const msg = respBody?.error ?? `Failed (${res.status})`;
        // If auto-fetch failed (502 from URL mode), flip to manual
        // mode so the user can paste title + price by hand without
        // losing their URL (we carry it over as the source link).
        if (mode === "url" && res.status === 502) {
          setMode("manual");
          setManualSourceUrl(input.trim());
          toast.error("Couldn't auto-load — switched to manual mode", {
            description:
              "Paste the title + price from the AE page and click Run again.",
            duration: 7000,
          });
          return;
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as HuntResult;
      setResult(data);
      toast.success(`Hunt complete — verdict: ${data.verdictLabel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast.error("Reverse Hunt failed", { description: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Input card */}
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-emerald-500 to-orange-500 ring-1 ring-orange-500/30 flex items-center justify-center shadow shadow-orange-500/30">
              <ShoppingBag className="size-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-400">
                Will it sell?
              </p>
              <h3 className="text-[16px] font-bold leading-tight">
                {mode === "url"
                  ? "Paste an AliExpress product URL"
                  : "Enter product info manually"}
              </h3>
            </div>
          </div>

          {/* Mode toggle — URL (auto-fetch) vs Manual (paste title + price) */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-1 ring-1 ring-border/40">
            <button
              type="button"
              onClick={() => setMode("url")}
              disabled={loading}
              className={`relative rounded-lg px-3 py-2 text-left transition-all ${
                mode === "url"
                  ? "bg-card shadow-sm ring-1 ring-border/60"
                  : "hover:bg-card/60 disabled:opacity-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`size-7 rounded-md flex items-center justify-center ${
                    mode === "url"
                      ? "bg-gradient-to-br from-emerald-500 to-orange-500 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Link2 className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <p
                    className={`text-[11px] font-bold ${
                      mode === "url" ? "text-foreground" : "text-foreground/70"
                    }`}
                  >
                    Paste URL
                  </p>
                  <p className="text-[9px] text-muted-foreground leading-tight">
                    Auto-fetch (.com)
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              disabled={loading}
              className={`relative rounded-lg px-3 py-2 text-left transition-all ${
                mode === "manual"
                  ? "bg-card shadow-sm ring-1 ring-border/60"
                  : "hover:bg-card/60 disabled:opacity-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`size-7 rounded-md flex items-center justify-center ${
                    mode === "manual"
                      ? "bg-gradient-to-br from-violet-500 to-pink-500 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <PenLine className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <p
                    className={`text-[11px] font-bold ${
                      mode === "manual"
                        ? "text-foreground"
                        : "text-foreground/70"
                    }`}
                  >
                    Manual entry
                  </p>
                  <p className="text-[9px] text-muted-foreground leading-tight">
                    Works for .us URLs
                  </p>
                </div>
              </div>
            </button>
          </div>

          {/* URL mode input */}
          {mode === "url" && (
            <>
              <Input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit()) handleHunt();
                }}
                placeholder="https://www.aliexpress.com/item/1005006123456789.html"
                disabled={loading}
                className="h-12 text-sm bg-muted/20 border-border/70 focus-visible:border-emerald-500/60 focus-visible:ring-emerald-500/15"
              />
              <p className="text-[11px] text-muted-foreground/80">
                Tip: any AliExpress product URL works. Numeric product ID
                (e.g. <code className="px-1 py-0.5 rounded bg-muted/40 text-[10px]">1005006123456789</code>) also works.
                <br />
                <strong>aliexpress.us URLs</strong> often need manual
                mode (Cloudflare blocks our scraper).
              </p>
            </>
          )}

          {/* Manual mode inputs */}
          {mode === "manual" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="manual-title"
                  className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground"
                >
                  Product title <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="manual-title"
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g. Boho silver moon ring vintage handmade"
                  disabled={loading}
                  maxLength={300}
                  className="h-10 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="manual-price"
                    className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground"
                  >
                    AE price (USD) <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="manual-price"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                    placeholder="0.00"
                    disabled={loading}
                    className="h-10 text-sm tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="manual-image"
                    className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground"
                  >
                    Image URL <span className="text-muted-foreground/50 font-normal">(optional)</span>
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
              </div>
              {manualSourceUrl && (
                <div className="text-[10px] text-muted-foreground italic truncate">
                  Source URL preserved: {manualSourceUrl.slice(0, 80)}
                  {manualSourceUrl.length > 80 ? "…" : ""}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground/80">
                Tip: copy the product title from the AE.us page header and
                paste the visible price. Image URL is optional but makes
                the result card look nicer.
              </p>
            </div>
          )}

          <Button
            type="button"
            onClick={handleHunt}
            disabled={!canSubmit()}
            className="w-full h-12 bg-gradient-to-r from-emerald-500 to-orange-500 hover:opacity-90 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/30 disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Checking Etsy demand…
              </>
            ) : (
              <>
                <Sparkles className="size-4 mr-2" />
                Run Reverse Hunt
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Result panel */}
      {result && <ResultPanel result={result} isCeo={isCeo} />}
    </div>
  );
}

function ResultPanel({
  result,
  isCeo,
}: {
  result: HuntResult;
  isCeo: boolean;
}) {
  const theme = VERDICT_THEME[result.verdict];
  const Icon = theme.icon;
  return (
    <div className="space-y-4">
      {/* Verdict header */}
      <Card className={`border-2 ${theme.ring} ring-2 shadow-lg`}>
        <CardContent className="p-6 flex items-center gap-4">
          <div
            className={`size-14 rounded-2xl ${theme.bg} text-white flex items-center justify-center shadow-lg ring-2 ring-white/40 shrink-0`}
          >
            <Icon className="size-7" strokeWidth={3} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Verdict
            </p>
            <h2 className={`text-2xl font-bold tracking-tight ${theme.text}`}>
              {result.verdictLabel}
            </h2>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Projected margin
            </p>
            <p className="text-2xl font-bold tabular-nums">
              ${result.estimatedMarginUsd.toFixed(2)}
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {result.estimatedMarginPct.toFixed(0)}% per sale
            </p>
          </div>
        </CardContent>
      </Card>

      {/* AliExpress product + recommended price */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border border-border/60 shadow-none">
          <CardContent className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-400 mb-3">
              AliExpress source
            </p>
            <div className="flex gap-3">
              <div className="size-24 rounded-lg bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center">
                {result.aliProduct.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={result.aliProduct.imageUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <Package className="size-8 text-muted-foreground/40" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-snug line-clamp-3 font-medium">
                  {result.aliProduct.title}
                </p>
                <p className="text-lg font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
                  ${result.aliProduct.priceMin.toFixed(2)}
                </p>
                <div className="mt-1 flex items-center gap-2.5 text-[11px] text-muted-foreground tabular-nums">
                  {result.aliProduct.rating !== undefined && (
                    <span className="inline-flex items-center gap-0.5">
                      <Star
                        className="size-3 text-amber-500"
                        fill="currentColor"
                        strokeWidth={0}
                      />
                      {result.aliProduct.rating.toFixed(1)}
                    </span>
                  )}
                  {result.aliProduct.orderCount !== undefined && (
                    <span>
                      {result.aliProduct.orderCount.toLocaleString()} sold
                    </span>
                  )}
                </div>
                {result.aliProduct.productUrl && (
                  <a
                    href={result.aliProduct.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-orange-600 dark:text-orange-400 hover:underline"
                  >
                    Open on AliExpress
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/60 shadow-none">
          <CardContent className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-400 mb-3">
              Recommended Etsy price
            </p>
            <div className="flex items-center gap-3 mb-3">
              <div className="size-12 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 ring-1 ring-violet-500/30 flex items-center justify-center">
                <DollarSign className="size-6 text-white" />
              </div>
              <div>
                <p className="text-3xl font-bold tabular-nums tracking-tight">
                  ${result.recommendedEtsyPrice.toFixed(2)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Listing price after 0.575 Etsy take rate
                </p>
              </div>
            </div>
            <div className="space-y-1.5 pt-3 border-t border-border/40">
              <RowStat
                label="AliExpress cost"
                value={`$${result.aliProduct.priceMin.toFixed(2)}`}
              />
              <RowStat
                label="Etsy listing price"
                value={`$${result.recommendedEtsyPrice.toFixed(2)}`}
              />
              <RowStat
                label="Projected profit per sale"
                value={`$${result.estimatedMarginUsd.toFixed(2)}`}
                emphasis
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Etsy demand snapshot */}
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">
              Etsy demand snapshot
            </p>
            <span className="text-[11px] text-muted-foreground italic">
              Searched: &ldquo;{result.etsyDemand.searchKeyword}&rdquo;
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatBox
              label="Total listings"
              value={result.etsyDemand.totalListings.toLocaleString()}
              hint="competition"
            />
            <StatBox
              label="Avg top price"
              value={`$${result.etsyDemand.avgTopPrice.toFixed(2)}`}
              hint="benchmark"
            />
            <StatBox
              label="Avg top favs"
              value={result.etsyDemand.avgTopFavorites.toLocaleString()}
              hint="buyer interest"
            />
          </div>
          {result.etsyDemand.topListings.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-border/40">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Top {result.etsyDemand.topListings.length} ranking Etsy listings
              </p>
              {result.etsyDemand.topListings.map((l) => (
                <div
                  key={l.listingId}
                  className="rounded-md bg-muted/20 ring-1 ring-border/40 px-3 py-2 flex items-start gap-2"
                >
                  <Heart
                    className="size-3 text-rose-500 mt-0.5 shrink-0"
                    fill="currentColor"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] line-clamp-1">{l.title}</p>
                    <p className="text-[10px] tabular-nums text-muted-foreground mt-0.5">
                      ${l.price.toFixed(2)} · {l.favorites.toLocaleString()} favorites
                    </p>
                  </div>
                  {l.url && (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground/60 hover:text-foreground"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reasons */}
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-3">
            Why this verdict
          </p>
          <ul className="space-y-2">
            {result.reasons.map((r, i) => (
              <li key={i} className="text-[13px] flex items-start gap-2">
                <span className="mt-1.5 size-1.5 rounded-full bg-foreground/60 shrink-0" />
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Footer cost note — CEO only */}
      {isCeo && (
        <p className="text-center text-[10px] text-muted-foreground tabular-nums">
          Cost: ${result.totalCostUsd.toFixed(4)} · {(result.durationMs / 1000).toFixed(1)}s
        </p>
      )}
    </div>
  );
}

function RowStat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={
          emphasis
            ? "text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400"
            : "text-[12px] font-semibold tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function StatBox({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg bg-muted/20 ring-1 ring-border/40 p-3">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-[18px] font-bold tabular-nums mt-1 leading-none">
        {value}
      </p>
      <p className="text-[9px] text-muted-foreground/70 mt-1 italic">{hint}</p>
    </div>
  );
}
