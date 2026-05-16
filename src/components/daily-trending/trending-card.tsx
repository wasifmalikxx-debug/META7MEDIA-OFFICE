"use client";

import Link from "next/link";
import {
  ExternalLink,
  Calculator,
  Target,
  Check,
  Loader2,
  Package,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Single trending product card.
 *
 * Pure presentational — claim/unclaim handlers are wired in by the
 * parent <DailyTrendingView>. This file owns ONLY the visual shell
 * + hover states, so style tweaks land here without touching state.
 *
 * Three primary CTAs (left → right):
 *   1. Open AE       — direct link, opens new tab
 *   2. Calc          — /price-calculator?aeUrl=... (calculator pre-fills)
 *   3. Hunt niche    — /seo-autopilot/product-hunter?niche=... (Manual Hunting prefills)
 *
 * Plus the claim button — flips between Claim (when nobody owns) and
 * Claimed by [name] (when someone has it). Claimer + CEO can toggle off.
 */

export interface TrendingCardData {
  id: string;
  niche: string;
  aeProductId: string;
  title: string;
  imageUrl: string | null;
  priceUsd: number;
  ordersCount: number | null;
  /** 0-5 stars; null when AE didn't return rating data. */
  ratingStars?: number | null;
  productUrl: string;
  suggestedEtsyMatured: number;
  suggestedEtsyNew: number;
  claimedById: string | null;
  claimedByName: string | null;
}

export function TrendingCard({
  product,
  currentUserId,
  isCeo,
  busy,
  onClaim,
  onUnclaim,
}: {
  product: TrendingCardData;
  currentUserId: string;
  isCeo: boolean;
  busy: boolean;
  onClaim: (id: string) => void;
  onUnclaim: (id: string) => void;
}) {
  const isClaimed = !!product.claimedById;
  const isMine = product.claimedById === currentUserId;
  const canUnclaim = isMine || isCeo;
  const margin = product.suggestedEtsyMatured - product.priceUsd;

  // Build deep links — both encode the niche/url into the destination
  // so the calculator + product hunter pre-fill on landing.
  const calcHref = `/price-calculator?aeUrl=${encodeURIComponent(product.productUrl)}`;
  const huntHref = `/seo-autopilot/product-hunter?niche=${encodeURIComponent(product.niche)}`;

  return (
    <div
      className={`group relative rounded-2xl border bg-card overflow-hidden transition-shadow hover:shadow-md ${
        isClaimed
          ? isMine
            ? "ring-1 ring-emerald-400/40 border-emerald-200/60 dark:border-emerald-800/40"
            : "ring-1 ring-amber-400/30 border-amber-200/50 dark:border-amber-800/30"
          : "border-border/60"
      }`}
    >
      {/* Claim badge — top-right corner, absolute */}
      {isClaimed && (
        <div
          className={`absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide shadow-sm backdrop-blur-md ${
            isMine
              ? "bg-emerald-500/90 text-white ring-1 ring-emerald-300"
              : "bg-amber-500/90 text-white ring-1 ring-amber-300"
          }`}
        >
          <Check className="size-3" strokeWidth={3} />
          {isMine ? "You" : product.claimedByName ?? "claimed"}
        </div>
      )}

      {/* Thumbnail */}
      <div className="relative aspect-square bg-muted/40 overflow-hidden">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <Package className="size-10 m-auto text-muted-foreground/30 mt-12" />
        )}
        {/* Order count chip — bottom-left */}
        {product.ordersCount != null && product.ordersCount > 0 && (
          <div className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-white tabular-nums">
            {formatOrders(product.ordersCount)} sold
          </div>
        )}

        {/* Rating chip — bottom-right (only when AE returned rating) */}
        {product.ratingStars != null && product.ratingStars > 0 && (
          <div className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-amber-500/95 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-white tabular-nums shadow-sm">
            <Star className="size-2.5 fill-white" strokeWidth={0} />
            {product.ratingStars.toFixed(1)}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-2.5">
        <p className="text-[12px] font-medium leading-snug line-clamp-2 min-h-[32px]">
          {product.title}
        </p>

        {/* Price block — AE → Etsy + margin chip */}
        <div className="grid grid-cols-2 gap-1.5 text-[11px] tabular-nums">
          <div className="rounded-lg bg-muted/40 px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80">
              AE cost
            </p>
            <p className="font-bold text-foreground/90">
              ${product.priceUsd.toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20 px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Etsy
            </p>
            <p className="font-bold text-emerald-700 dark:text-emerald-300">
              ${product.suggestedEtsyMatured.toFixed(2)}
            </p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground tabular-nums px-0.5">
          Margin{" "}
          <span className="font-bold text-foreground/85">
            ${margin.toFixed(2)}
          </span>{" "}
          · New shop ${product.suggestedEtsyNew.toFixed(2)}
        </p>

        {/* Action row — AE / Calc / Hunt as compact buttons */}
        <div className="grid grid-cols-3 gap-1.5">
          <a
            href={product.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1 h-8 rounded-md text-[10px] font-bold tracking-wide bg-muted hover:bg-muted/70 transition-colors"
            title="Open on AliExpress"
          >
            <ExternalLink className="size-3" />
            AE
          </a>
          <Link
            href={calcHref}
            className="inline-flex items-center justify-center gap-1 h-8 rounded-md text-[10px] font-bold tracking-wide bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition-colors"
            title="Open in Price Calculator"
          >
            <Calculator className="size-3" />
            Calc
          </Link>
          <Link
            href={huntHref}
            className="inline-flex items-center justify-center gap-1 h-8 rounded-md text-[10px] font-bold tracking-wide bg-violet-500/15 text-violet-700 dark:text-violet-300 hover:bg-violet-500/25 transition-colors"
            title="Hunt Etsy keywords for this niche"
          >
            <Target className="size-3" />
            Hunt
          </Link>
        </div>

        {/* Claim toggle — full-width below the action row */}
        {!isClaimed && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onClaim(product.id)}
            className="h-8 w-full text-[11px] font-bold bg-foreground text-background hover:bg-foreground/85 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              "+ Claim this product"
            )}
          </Button>
        )}
        {isClaimed && canUnclaim && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onUnclaim(product.id)}
            className="h-8 w-full text-[11px] font-bold disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              "Release claim"
            )}
          </Button>
        )}
        {isClaimed && !canUnclaim && (
          <div className="h-8 w-full inline-flex items-center justify-center text-[11px] text-muted-foreground italic rounded-md bg-muted/30">
            Locked by {product.claimedByName ?? "another seller"}
          </div>
        )}
      </div>
    </div>
  );
}

function formatOrders(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
