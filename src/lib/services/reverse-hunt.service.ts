/**
 * Reverse Hunt — Play 2.
 *
 * Pipeline: paste an AliExpress product URL → fetch product details →
 * search Etsy for matching listings → score "will it sell".
 *
 * Output: { aliProduct, etsyDemand, verdict, estimatedMargin }
 */

import {
  getProductById,
  extractProductId,
  type AliExpressProduct,
} from "./aliexpress-api.service";
import {
  searchActiveListingsWithCount,
  type EtsyListing,
} from "./etsy-api.service";
import { extractSearchContext, createCostAccumulator } from "./anthropic.service";
import { calculateEtsyPrice } from "@/lib/etsy-price-calculator";

export type ReverseHuntVerdict = "STRONG_YES" | "YES" | "MAYBE" | "NO";

export interface EtsyDemandSnapshot {
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

export interface ReverseHuntResponse {
  aliProduct: AliExpressProduct;
  etsyDemand: EtsyDemandSnapshot;
  verdict: ReverseHuntVerdict;
  verdictLabel: string;
  reasons: string[];
  recommendedEtsyPrice: number;
  estimatedMarginUsd: number;
  estimatedMarginPct: number;
  totalCostUsd: number;
  durationMs: number;
}

const VERDICT_LABELS: Record<ReverseHuntVerdict, string> = {
  STRONG_YES: "Strong yes — source this",
  YES: "Yes — worth listing",
  MAYBE: "Maybe — thin margins",
  NO: "Skip — won't sell",
};

/**
 * Score on the same dimensions as Product Hunter:
 *   - Demand (Etsy listing count + avg favorites)
 *   - Margin (Etsy retail vs AliExpress cost vs Etsy fees)
 *
 * Returns the verdict + the dollar/percent margin so the team can
 * make a sourcing decision in under 10 seconds.
 */
export async function reverseHunt(
  aliUrlOrId: string,
  accessToken: string,
): Promise<ReverseHuntResponse> {
  const startedAt = Date.now();
  const accum = createCostAccumulator();

  const trimmed = aliUrlOrId.trim();
  const productId =
    /^\d+$/.test(trimmed) ? trimmed : extractProductId(aliUrlOrId);
  if (!productId) {
    throw new Error("Couldn't extract product ID from that URL.");
  }

  // Detect aliexpress.us / aliexpress.ru / other regional storefronts —
  // their product IDs (typically starting with "3256") belong to
  // separate regional catalogs that the global DS API doesn't always
  // serve. The call still "succeeds" but returns an empty product
  // (no title, no price), which then produces nonsense downstream
  // (a $0 cost product with random Etsy search results).
  //
  // The .com and .us product ID prefixes:
  //   - aliexpress.com IDs typically start with "1005" (16 digits)
  //   - aliexpress.us IDs typically start with "3256" (16 digits)
  const isUsRegionalId = productId.startsWith("3256");
  const isUsRegionalUrl = /aliexpress\.(us|ru|fr|de|es|it|pl)/i.test(
    aliUrlOrId,
  );

  // Step 1: fetch AliExpress product
  const aliProduct = await getProductById(productId, { accessToken });
  if (!aliProduct) {
    throw new Error(
      "AliExpress product not found — it may be unlisted or restricted.",
    );
  }

  // Validate the AE response actually contains real product data.
  // The DS API returns a "successful" empty response for products
  // outside its catalog (e.g. aliexpress.us regional IDs) — without
  // this check we'd run the rest of the pipeline on $0 cost + empty
  // title and produce nonsense Etsy results.
  const titleOk = aliProduct.title && aliProduct.title.trim().length > 0;
  const priceOk = aliProduct.priceMin && aliProduct.priceMin > 0;
  if (!titleOk || !priceOk) {
    if (isUsRegionalId || isUsRegionalUrl) {
      throw new Error(
        "This is an aliexpress.us URL — those use a separate regional catalog that our API can't read. Find the same product on aliexpress.com (product ID usually starts with 1005…) and paste that URL instead.",
      );
    }
    throw new Error(
      "AliExpress returned empty data for this product — it may be unlisted, restricted, or unavailable in the global catalog.",
    );
  }

  // Step 2: Haiku extracts a search-friendly keyword from the AliExpress title
  // (AliExpress titles are usually keyword-stuffed garbage)
  const ctx = await extractSearchContext(aliProduct.title, accum);
  const searchKeyword = ctx.searchKeyword || aliProduct.title.split(" ").slice(0, 4).join(" ");

  // Step 3: Etsy demand check
  const { totalListings, results: etsyResults } =
    await searchActiveListingsWithCount(searchKeyword, 10, "score");

  const etsyPrices = etsyResults
    .map((r: EtsyListing) => Number(r.price?.amount ?? 0) / 100)
    .filter((p) => p > 0);
  const avgTopPrice =
    etsyPrices.length > 0
      ? etsyPrices.reduce((s, p) => s + p, 0) / etsyPrices.length
      : 0;
  const avgTopFavorites =
    etsyResults.length > 0
      ? etsyResults.reduce((s, r) => s + (r.num_favorers ?? 0), 0) /
        etsyResults.length
      : 0;

  // Step 4: margin math — use the team's existing markup table.
  // Formula: matured = (ali + markup) / 0.425, so seller net after Etsy
  // fees = matured × 0.425 = ali + markup, which means PROFIT = markup.
  // That's the whole point of the stepped-markup table.
  const aliCost = aliProduct.priceMin;
  const pricing = calculateEtsyPrice(aliCost);
  const recommendedEtsyPrice = pricing.etsyMatured;
  const estimatedMarginUsd = pricing.markup;
  const estimatedMarginPct =
    recommendedEtsyPrice > 0
      ? (estimatedMarginUsd / recommendedEtsyPrice) * 100
      : 0;

  // Step 5: verdict
  const reasons: string[] = [];
  let verdict: ReverseHuntVerdict = "MAYBE";

  // Demand bucket
  let demandScore = 0;
  if (totalListings >= 100 && totalListings <= 5000) {
    demandScore = 3;
    reasons.push(
      `Healthy demand — ${totalListings.toLocaleString()} Etsy listings means buyers actively search this.`,
    );
  } else if (totalListings > 5000) {
    demandScore = 1;
    reasons.push(
      `Saturated — ${totalListings.toLocaleString()} Etsy listings, harder to rank.`,
    );
  } else if (totalListings >= 30) {
    demandScore = 2;
    reasons.push(
      `Niche market — ${totalListings.toLocaleString()} listings, low competition.`,
    );
  } else {
    demandScore = 0;
    reasons.push(
      `Very thin — only ${totalListings} Etsy listings exist for this keyword.`,
    );
  }

  // Engagement bucket
  let engagementScore = 0;
  if (avgTopFavorites >= 100) {
    engagementScore = 3;
    reasons.push(
      `Strong buyer interest — avg ${Math.round(avgTopFavorites)} favorites in top results.`,
    );
  } else if (avgTopFavorites >= 30) {
    engagementScore = 2;
    reasons.push(
      `Moderate interest — avg ${Math.round(avgTopFavorites)} favorites.`,
    );
  } else {
    reasons.push(
      `Weak buyer signal — top listings have only ${Math.round(avgTopFavorites)} favorites avg.`,
    );
  }

  // Margin bucket
  let marginScore = 0;
  if (estimatedMarginUsd >= 12) {
    marginScore = 3;
    reasons.push(
      `Excellent margin — projected $${estimatedMarginUsd.toFixed(2)} profit per sale (${estimatedMarginPct.toFixed(0)}%).`,
    );
  } else if (estimatedMarginUsd >= 7) {
    marginScore = 2;
    reasons.push(
      `Decent margin — $${estimatedMarginUsd.toFixed(2)}/sale (${estimatedMarginPct.toFixed(0)}%).`,
    );
  } else if (estimatedMarginUsd >= 3) {
    marginScore = 1;
    reasons.push(
      `Thin margin — only $${estimatedMarginUsd.toFixed(2)}/sale. Volume needed.`,
    );
  } else {
    marginScore = 0;
    reasons.push(
      `Margin too thin — $${estimatedMarginUsd.toFixed(2)}/sale is not worth the time.`,
    );
  }

  const totalScore = demandScore + engagementScore + marginScore;
  if (totalScore >= 8) verdict = "STRONG_YES";
  else if (totalScore >= 6) verdict = "YES";
  else if (totalScore >= 3) verdict = "MAYBE";
  else verdict = "NO";

  return {
    aliProduct,
    etsyDemand: {
      searchKeyword,
      totalListings,
      avgTopPrice,
      avgTopFavorites,
      topListings: etsyResults.slice(0, 5).map((l: EtsyListing) => ({
        title: l.title,
        price: Number(l.price?.amount ?? 0) / 100,
        favorites: l.num_favorers ?? 0,
        listingId: l.listing_id,
        url: l.url,
      })),
    },
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    reasons,
    recommendedEtsyPrice,
    estimatedMarginUsd,
    estimatedMarginPct,
    totalCostUsd: accum.totalCostUsd,
    durationMs: Date.now() - startedAt,
  };
}
