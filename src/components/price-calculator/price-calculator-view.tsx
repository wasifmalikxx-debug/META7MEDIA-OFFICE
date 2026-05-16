"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Copy,
  AlertTriangle,
  RefreshCcw,
  Store,
  Sprout,
  Tag,
  Link2,
  Loader2,
  Wand2,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import {
  calculateEtsyPrice,
  NEW_SHOP_DISCOUNT,
} from "@/lib/etsy-price-calculator";

/**
 * Etsy price calculator — employee-facing UI (v3 redesign).
 *
 * Layout:
 *   • Slim red banner — 50% sale reminder (non-dismissible)
 *   • One unified card with two stacked zones:
 *       - Input zone (muted bg)  — Ali Express cost, big tabular number
 *       - Output zone (card bg)  — two price cards side-by-side
 *   • Each price card surfaces both the LISTING price (big hero number)
 *     AND the BUYER-FACING price after the assumed 50% sale, so the
 *     employee can see what the customer will actually see.
 *
 * Intentionally hidden:
 *   • Markup-tier breakdown (no formula leakage)
 *   • Markup table reference (same reason)
 *   • The 2/3 proportional regime above $150 (employees just see prices)
 */
interface FetchedProduct {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceMin: number;
  priceMax: number;
  currency: string;
  rating?: number;
  orderCount?: number;
}

export function PriceCalculatorView() {
  const [aliInput, setAliInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [urlMode, setUrlMode] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchedProduct, setFetchedProduct] = useState<FetchedProduct | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFetchFromUrl() {
    if (urlInput.trim().length < 8 || fetching) return;
    setFetching(true);
    setFetchedProduct(null);
    try {
      const res = await fetch("/api/aliexpress/fetch-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error(
            "AliExpress not connected. Wasif needs to connect it on Product Hunter first.",
          );
        }
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as FetchedProduct;
      setFetchedProduct(data);
      setAliInput(data.priceMin.toFixed(2));
      toast.success(`Fetched: $${data.priceMin.toFixed(2)}`);
    } catch (err) {
      toast.error("Couldn't fetch from AliExpress", {
        description: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      setFetching(false);
    }
  }

  // ⌘K / Ctrl+K from anywhere refocuses + selects the input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const aliPrice = useMemo(() => {
    const trimmed = aliInput.trim();
    if (!trimmed) return null;
    const n = parseFloat(trimmed);
    if (isNaN(n) || n < 0) return null;
    return n;
  }, [aliInput]);

  // Per-browser personalization seed — generated once on first
  // visit, persisted to localStorage. Passing it to
  // calculateEtsyPrice() adds a deterministic ±$2 offset that's
  // unique to this user/browser. Two sellers pricing the same
  // AliExpress item get different Etsy prices, but each seller
  // sees stable prices across page reloads.
  const userSeed = usePriceCalcSeed();
  const result = useMemo(
    () =>
      aliPrice == null
        ? null
        : calculateEtsyPrice(aliPrice, { userSeed }),
    [aliPrice, userSeed],
  );

  function handleCopy(value: number, label: string) {
    const formatted = value.toFixed(2);
    navigator.clipboard.writeText(formatted);
    toast.success(`Copied ${label} · $${formatted}`);
  }

  function handleClear() {
    setAliInput("");
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-6">
      <ReminderBanner />

      {/* Mode toggle — manual cost entry vs. auto-fetch from AliExpress URL.
          The URL mode is Play 5 (Live Margin Calculator). */}
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => setUrlMode(false)}
          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-bold tracking-wide transition-colors ${
            !urlMode
              ? "bg-card ring-1 ring-border/60 shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Tag className="size-3" />
          Enter cost
        </button>
        <button
          type="button"
          onClick={() => setUrlMode(true)}
          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-bold tracking-wide transition-colors ${
            urlMode
              ? "bg-card ring-1 ring-border/60 shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Link2 className="size-3" />
          Auto from AliExpress URL
        </button>
      </div>

      {/* AliExpress URL fetch card — only when urlMode */}
      {urlMode && (
        <Card className="border border-emerald-300/50 dark:border-emerald-700/40 bg-emerald-50/30 dark:bg-emerald-950/15 shadow-none">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-gradient-to-br from-emerald-500 to-orange-500 ring-1 ring-orange-500/30 flex items-center justify-center">
                <Wand2 className="size-4 text-white" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                  Live AliExpress price
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Paste any AliExpress product URL · we&apos;ll grab the live cost
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleFetchFromUrl();
                }}
                placeholder="https://www.aliexpress.com/item/..."
                disabled={fetching}
                className="h-10 text-sm bg-card border-border/70"
              />
              <Button
                type="button"
                onClick={handleFetchFromUrl}
                disabled={urlInput.trim().length < 8 || fetching}
                className="h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold whitespace-nowrap disabled:opacity-40"
              >
                {fetching ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Fetch price"
                )}
              </Button>
            </div>
            {fetchedProduct && (
              <div className="flex gap-3 pt-3 border-t border-emerald-300/40 dark:border-emerald-700/30">
                <div className="size-14 rounded-lg bg-muted/40 overflow-hidden shrink-0">
                  {fetchedProduct.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fetchedProduct.imageUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <Package className="size-5 m-auto text-muted-foreground/40" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] line-clamp-2 font-medium leading-snug">
                    {fetchedProduct.title}
                  </p>
                  <p className="text-[11px] tabular-nums text-muted-foreground mt-0.5">
                    Live cost: <strong>${fetchedProduct.priceMin.toFixed(2)}</strong>
                    {fetchedProduct.orderCount !== undefined &&
                      ` · ${fetchedProduct.orderCount.toLocaleString()} sold`}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Input card — separate from the output below so the two zones
          feel distinct (per Wasif's preference for the older layout). */}
      <Card className="border shadow-none">
        <CardContent className="p-6 sm:p-8">
          <div className="max-w-2xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="ali-price"
                className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em] flex items-center gap-1.5"
              >
                <Tag className="size-3" />
                Ali Express Cost
              </Label>
              <p className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[9px] font-mono">⌘K</kbd>
                <span>to focus</span>
              </p>
            </div>
            <div className="relative">
              <span className="absolute left-5 top-1/2 -translate-y-1/2 text-3xl font-bold text-muted-foreground/40 pointer-events-none select-none">
                $
              </span>
              <Input
                id="ali-price"
                ref={inputRef}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={aliInput}
                onChange={(e) => setAliInput(e.target.value)}
                className="h-20 pl-12 pr-14 text-4xl font-bold tabular-nums tracking-tight"
                autoFocus
              />
              {aliInput && (
                <button
                  onClick={handleClear}
                  type="button"
                  className="absolute right-4 top-1/2 -translate-y-1/2 size-8 rounded-md hover:bg-muted/60 flex items-center justify-center transition-colors"
                  title="Clear"
                  aria-label="Clear input"
                >
                  <RefreshCcw className="size-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Output — side-by-side price cards in their own section
          (not wrapped in an outer card; each price card has its own
          surface for stronger individual presence). */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.16em]">
            Your Etsy Listing Price
          </p>
          {result && (
            <p className="text-[10px] text-muted-foreground tabular-nums">
              Based on ${result.aliPrice.toFixed(2)} Ali cost
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
          <PriceCard
            title="Matured Shop"
            subtitle="Standard listing price"
            icon={Store}
            tone="emerald"
            value={result?.etsyMatured ?? null}
            badge={null}
            onCopy={() =>
              result && handleCopy(result.etsyMatured, "Matured Shop")
            }
          />
          <PriceCard
            title="New Shop"
            subtitle={`${(NEW_SHOP_DISCOUNT * 100).toFixed(0)}% lower to win first sales`}
            icon={Sprout}
            tone="amber"
            value={result?.etsyNew ?? null}
            badge={`−${(NEW_SHOP_DISCOUNT * 100).toFixed(0)}%`}
            onCopy={() => result && handleCopy(result.etsyNew, "New Shop")}
          />
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────── ReminderBanner ───────────────────────────

/**
 * Premium reminder banner — the 50% sale callout.
 *
 * Visual layers (back to front):
 *   1. Gradient base (rose-500 → rose-700, diagonal)
 *   2. Two soft glow blobs (rose-300 + orange-400) for warmth + depth
 *   3. Diagonal stripe pattern at 8% opacity — caution-tape texture
 *   4. Inset ring for crisp edges
 *   5. Icon chip with frosted glass + pulsing halo
 *   6. "REQUIRED" pill with live dot
 *   7. Underlined "50% sale" emphasis in the body copy
 *
 * Non-dismissible — every listing needs the sale set.
 */

// ─── Per-browser personalization seed ──────────────────────────────
//
// Returns a stable random string unique to this browser. Generated on
// first visit, persisted to localStorage. Passed to calculateEtsyPrice
// to apply a deterministic ±$2 offset per (user, ali price). Two
// different sellers pricing the same AE item get different Etsy prices;
// the same seller always sees stable prices on reload.
//
// SSR-safe: returns "" on the server (no offset applied), then
// hydrates with the real seed on mount. Since the calculator only
// computes a result after the user types a price (post-mount), the
// hydration delay never matters in practice.
const PRICE_CALC_SEED_KEY = "priceCalc.userSeed.v1";

function usePriceCalcSeed(): string {
  const [seed] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      const existing = window.localStorage.getItem(PRICE_CALC_SEED_KEY);
      if (existing && existing.length > 0) return existing;
      // Generate a 12-char random seed (~62 bits of entropy — plenty)
      const fresh =
        Math.random().toString(36).slice(2, 8) +
        Math.random().toString(36).slice(2, 8);
      window.localStorage.setItem(PRICE_CALC_SEED_KEY, fresh);
      return fresh;
    } catch {
      // localStorage blocked? fall back to no-seed (formula-only price)
      return "";
    }
  });
  return seed;
}

function ReminderBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-rose-500 via-rose-600 to-rose-700 dark:from-rose-600 dark:via-rose-700 dark:to-rose-800 shadow-lg shadow-rose-500/20 dark:shadow-rose-950/40 ring-1 ring-rose-700/40">
      {/* Soft glow blobs for depth */}
      <div
        aria-hidden
        className="absolute -top-16 -left-12 size-48 rounded-full bg-rose-300/25 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute -bottom-20 -right-12 size-56 rounded-full bg-orange-400/20 blur-3xl pointer-events-none"
      />

      {/* Diagonal stripe texture — caution-tape feel at low opacity */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent 0, transparent 18px, rgba(255,255,255,0.6) 18px, rgba(255,255,255,0.6) 19px)",
        }}
      />

      <div className="relative flex items-center gap-4 px-4 sm:px-6 py-4">
        {/* Icon chip — frosted glass with pulsing halo */}
        <div className="relative shrink-0">
          <span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-white/40 animate-pulse blur-sm"
          />
          <div className="relative size-11 rounded-xl bg-white/15 ring-1 ring-white/40 flex items-center justify-center backdrop-blur-sm shadow-inner">
            <AlertTriangle className="size-5 text-white" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.18em] uppercase bg-white/15 backdrop-blur-sm px-2 py-0.5 rounded-full ring-1 ring-white/25">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-white" />
              </span>
              Required
            </span>
          </div>
          <p className="text-sm sm:text-base font-bold text-white tracking-tight leading-tight">
            Set your listing to a{" "}
            <span className="underline decoration-white/70 decoration-2 underline-offset-[3px]">
              50% sale
            </span>{" "}
            before publishing
          </p>
          <p className="text-[11px] sm:text-[12px] text-white/85 mt-1 leading-snug">
            The calculator assumes a 50% Etsy sale is active — without it your listing goes live at full price.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── PriceCard ───────────────────────────

/**
 * One of the two output cards. Surfaces three things:
 *   1. The big LISTING price ($XX.XX) — the hero number, what the
 *      employee will put into Etsy's price field.
 *   2. The post-sale BUYER price (listing × 0.5) — what a customer
 *      will actually see on the listing page. Helps the employee
 *      sanity-check competitiveness without doing math.
 *   3. A copy button for the listing price.
 */
function PriceCard({
  title,
  subtitle,
  icon: Icon,
  tone,
  value,
  badge,
  onCopy,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "amber";
  value: number | null;
  badge: string | null;
  onCopy: () => void;
}) {
  const tones = {
    emerald: {
      bgActive:
        "bg-gradient-to-br from-emerald-50 via-emerald-50/60 to-emerald-50/30 dark:from-emerald-950/50 dark:via-emerald-950/30 dark:to-emerald-950/10",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/50",
      iconText: "text-emerald-700 dark:text-emerald-400",
      value: "text-emerald-700 dark:text-emerald-300",
      ring: "ring-emerald-300/50 dark:ring-emerald-700/40",
      divider: "border-emerald-200/60 dark:border-emerald-900/40",
      badge:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300",
    },
    amber: {
      bgActive:
        "bg-gradient-to-br from-amber-50 via-amber-50/60 to-amber-50/30 dark:from-amber-950/50 dark:via-amber-950/30 dark:to-amber-950/10",
      iconBg: "bg-amber-100 dark:bg-amber-900/50",
      iconText: "text-amber-700 dark:text-amber-400",
      value: "text-amber-700 dark:text-amber-300",
      ring: "ring-amber-300/50 dark:ring-amber-700/40",
      divider: "border-amber-200/70 dark:border-amber-900/40",
      badge:
        "bg-amber-200/80 text-amber-900 dark:bg-amber-900/60 dark:text-amber-300",
    },
  } as const;
  const t = tones[tone];
  const hasValue = value != null;
  // Half-price = what the buyer sees after the 50% sale is applied.
  const buyerPrice = hasValue ? value * 0.5 : null;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border transition-colors ${
        hasValue ? `${t.bgActive} ring-1 ${t.ring}` : "bg-card"
      }`}
    >
      <div className="p-5 sm:p-6 flex flex-col gap-4 min-h-[200px]">
        {/* Header — icon, title, optional badge */}
        <div className="flex items-start gap-3">
          <div
            className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${t.iconBg}`}
          >
            <Icon className={`size-5 ${t.iconText}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[13px] font-semibold leading-tight">
                {title}
              </h3>
              {badge && (
                <span
                  className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${t.badge}`}
                >
                  {badge}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Hero number — the listing price */}
        <div
          className={`text-[44px] sm:text-[52px] font-bold tabular-nums tracking-tight leading-none ${
            hasValue ? t.value : "text-muted-foreground/20"
          }`}
        >
          {hasValue ? `$${value.toFixed(2)}` : "$0.00"}
        </div>

        {/* Footer — buyer-facing price + copy button */}
        <div
          className={`mt-auto pt-3 border-t flex items-center justify-between gap-3 ${
            hasValue ? t.divider : "border-muted/30"
          }`}
        >
          <div className="text-[11px] text-muted-foreground min-w-0">
            {hasValue ? (
              <>
                <span className="text-muted-foreground/70">After 50% sale</span>
                <span className="font-semibold tabular-nums text-foreground/80 ml-1.5">
                  ${buyerPrice?.toFixed(2)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground/40">
                Enter an Ali cost above
              </span>
            )}
          </div>
          <Button
            onClick={onCopy}
            variant="outline"
            size="sm"
            disabled={!hasValue}
            className="gap-1.5 h-8 shrink-0 text-xs"
            title={`Copy ${title} price`}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
}
