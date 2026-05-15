"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ExternalLink,
  Heart,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Check,
  X,
  Link2,
  ShoppingBag,
  Star,
  DollarSign,
  Package,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

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
  {
    ring: string;
    bg: string;
    text: string;
    icon: typeof Check;
  }
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

type Mode = "url" | "image";

interface ImageSearchResult {
  totalResults: number;
  products: AliProductLite[];
}

export function ReverseHuntView({ isCeo }: { isCeo: boolean }) {
  const [mode, setMode] = useState<Mode>("url");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HuntResult | null>(null);
  const [imageResult, setImageResult] = useState<ImageSearchResult | null>(
    null,
  );

  async function handleHunt() {
    if (input.trim().length < 8 || loading) return;
    setLoading(true);
    setResult(null);
    setImageResult(null);
    try {
      if (mode === "url") {
        const res = await fetch("/api/reverse-hunt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: input.trim() }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 409) {
            throw new Error(
              "AliExpress not connected. Ask Wasif to connect on the Product Hunter page first.",
            );
          }
          throw new Error(body?.error ?? `Failed (${res.status})`);
        }
        const data = (await res.json()) as HuntResult;
        setResult(data);
        toast.success(`Hunt complete — verdict: ${data.verdictLabel}`);
      } else {
        const res = await fetch("/api/aliexpress/image-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: input.trim() }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 409) {
            throw new Error(
              "AliExpress not connected. Ask Wasif to connect on the Product Hunter page first.",
            );
          }
          throw new Error(body?.error ?? `Failed (${res.status})`);
        }
        const data = (await res.json()) as ImageSearchResult;
        setImageResult(data);
        toast.success(`Found ${data.products.length} similar products`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast.error(mode === "url" ? "Reverse Hunt failed" : "Image search failed", {
        description: msg,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* ─────────────── Hero ─────────────── */}
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-emerald-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1f1c] via-[#0d1a2a] to-[#1a1226]" />
        <div
          aria-hidden
          className="absolute -top-20 -left-20 size-[420px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(16,185,129,0.5), rgba(16,185,129,0) 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 right-0 size-[480px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(245,158,11,0.45), rgba(245,158,11,0) 70%)",
          }}
        />

        <div className="relative px-7 sm:px-9 py-9 sm:py-11">
          <div className="flex items-center gap-2 mb-5">
            <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              Live · Will it sell?
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <span
                aria-hidden
                className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-emerald-400/40 to-orange-500/40 blur-lg"
              />
              <div className="relative size-16 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl">
                <Link2 className="size-7 text-white drop-shadow-lg" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.05]">
                Reverse Hunt
              </h1>
              <p className="text-[13px] sm:text-sm text-white/75 mt-2 leading-relaxed max-w-2xl">
                Paste an AliExpress product link — we&apos;ll fetch the
                product, check Etsy demand, project your margin, and tell you
                in plain English: <strong className="text-white">source it</strong>{" "}
                or <strong className="text-white">skip it</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 rounded-xl bg-muted/40 p-1 ring-1 ring-border/40 w-fit">
        <ModeTab
          active={mode === "url"}
          onClick={() => {
            setMode("url");
            setInput("");
            setResult(null);
            setImageResult(null);
          }}
          icon={Link2}
          label="By URL"
        />
        <ModeTab
          active={mode === "image"}
          onClick={() => {
            setMode("image");
            setInput("");
            setResult(null);
            setImageResult(null);
          }}
          icon={ImageIcon}
          label="By Image"
        />
      </div>

      {/* ─────────────── Input ─────────────── */}
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-emerald-500 to-orange-500 ring-1 ring-orange-500/30 flex items-center justify-center shadow shadow-orange-500/30">
              {mode === "url" ? (
                <ShoppingBag className="size-5 text-white" />
              ) : (
                <ImageIcon className="size-5 text-white" />
              )}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-400">
                Step one
              </p>
              <h3 className="text-[16px] font-bold leading-tight">
                {mode === "url"
                  ? "Paste the AliExpress product URL"
                  : "Paste an image URL (Etsy listing image works great)"}
              </h3>
            </div>
          </div>

          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim().length >= 8 && !loading)
                handleHunt();
            }}
            placeholder={
              mode === "url"
                ? "https://www.aliexpress.com/item/1005006123456789.html"
                : "https://i.etsystatic.com/.../image.jpg"
            }
            disabled={loading}
            className="h-12 text-sm bg-muted/20 border-border/70 focus-visible:border-emerald-500/60 focus-visible:ring-emerald-500/15"
          />
          <p className="text-[11px] text-muted-foreground/80">
            {mode === "url" ? (
              <>
                Tip: works with any AliExpress product URL. Numeric product ID
                (e.g.{" "}
                <code className="px-1 py-0.5 rounded bg-muted/40 text-[10px]">
                  1005006123456789
                </code>
                ) also works.
              </>
            ) : (
              <>
                Right-click a competitor&apos;s Etsy listing image → &ldquo;Copy
                Image Address&rdquo; → paste here. We&apos;ll find AliExpress
                products that look similar.
              </>
            )}
          </p>

          <Button
            type="button"
            onClick={handleHunt}
            disabled={input.trim().length < 8 || loading}
            className="w-full h-12 bg-gradient-to-r from-emerald-500 to-orange-500 hover:opacity-90 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/30 disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                {mode === "url"
                  ? "Checking Etsy demand…"
                  : "Searching AliExpress by image…"}
              </>
            ) : (
              <>
                <Sparkles className="size-4 mr-2" />
                {mode === "url" ? "Run Reverse Hunt" : "Find similar on AliExpress"}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ─────────────── Result ─────────────── */}
      {result && mode === "url" && (
        <ResultPanel result={result} isCeo={isCeo} />
      )}
      {imageResult && mode === "image" && (
        <ImageResultPanel result={imageResult} />
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Link2;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-bold tracking-wide transition-all ${
        active
          ? "bg-card ring-1 ring-border/60 shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function ImageResultPanel({ result }: { result: ImageSearchResult }) {
  if (result.products.length === 0) {
    return (
      <Card className="border border-border/60">
        <CardContent className="p-8 text-center">
          <ImageIcon className="size-7 mx-auto text-muted-foreground/60 mb-2" />
          <p className="text-sm font-bold">No similar products found</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Try a clearer image or a different angle.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-border/60 shadow-none">
      <CardContent className="p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400 mb-3">
          {result.products.length} similar products on AliExpress
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {result.products.map((p) => (
            <a
              key={p.productId}
              href={p.productUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-2.5 rounded-lg ring-1 ring-border/50 bg-card hover:bg-muted/30 transition-colors p-2.5"
            >
              <div className="size-16 rounded-md bg-muted/40 overflow-hidden shrink-0">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.imageUrl}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Package className="size-5 m-auto text-muted-foreground/40" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] leading-snug line-clamp-2">
                  {p.title}
                </p>
                <p className="text-[12px] font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
                  ${p.priceMin.toFixed(2)}
                </p>
                {p.rating !== undefined && (
                  <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5 inline-flex items-center gap-0.5">
                    <Star
                      className="size-2.5 text-amber-500"
                      fill="currentColor"
                      strokeWidth={0}
                    />
                    {p.rating.toFixed(1)}
                  </div>
                )}
              </div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultPanel({ result, isCeo }: { result: HuntResult; isCeo: boolean }) {
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
