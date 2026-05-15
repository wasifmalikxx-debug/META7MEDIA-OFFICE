/**
 * Product Hunter — find underserved Etsy keywords for product
 * hunting on AliExpress.
 *
 * Given a seed category/product type, this:
 *   1. Asks Haiku to brainstorm ~25 long-tail variants
 *   2. Queries Etsy for each variant in parallel (top 10 + total count
 *      + unique shop count)
 *   3. Scores each on demand · engagement · diversity · long-tail
 *   4. Returns the top hunt candidates sorted by score
 *
 * The output drives the CEO Product Hunter page — employees should
 * hunt AliExpress for the GREAT / GOOD keywords first.
 */

import {
  searchActiveListingsWithCount,
  type EtsyListing,
} from "./etsy-api.service";
import {
  expandSearchVariants,
  generateNicheCategories,
  generateCategoryKeywords,
  createCostAccumulator,
  type CostAccumulator,
} from "./anthropic.service";
import {
  searchProductsByKeyword,
  type AliExpressProduct,
} from "./aliexpress-api.service";
import { calculateEtsyPrice } from "@/lib/etsy-price-calculator";

export type ProductHuntVerdict = "GREAT" | "GOOD" | "MAYBE" | "SKIP";

export interface ProductHuntResult {
  keyword: string;
  totalListings: number; // saturation
  avgTopFavorites: number; // engagement signal
  uniqueShops: number; // top-10 diversity
  wordCount: number;
  score: number; // 0-100 composite
  verdict: ProductHuntVerdict;
  reasons: string[];
  topListings: Array<{
    title: string;
    favorites: number;
    listingId: number;
    url?: string;
  }>;
}

export interface ProductHuntResponse {
  seedKeyword: string;
  scanCount: number; // variants Haiku produced
  evaluated: number; // variants successfully scored (some may fail Etsy queries)
  totalCostUsd: number; // Anthropic only — Etsy is free
  durationMs: number;
  results: ProductHuntResult[]; // sorted desc by score
}

/**
 * Score a single keyword on its opportunity attractiveness for a new /
 * small Etsy shop. Heuristic, tuned for dropshipping use:
 *
 *   Demand (30 pts max)
 *     — 100-5k listings: ideal, real demand without overcrowding
 *     — 50-100: thin but worth probing
 *     — 5k-15k: workable but harder
 *     — 15k+ or <50: penalised
 *
 *   Engagement (25 pts max)
 *     — Avg top-10 favorites is the proxy for "people actually buy this"
 *
 *   Diversity (25 pts max)
 *     — Number of unique shops in the top 10. Less than 4 = one shop
 *       owns the rank → tough to displace.
 *
 *   Long-tail bonus (20 pts max)
 *     — 4+ word keywords rank way easier than 2-word ones for new shops.
 */
export function scoreCandidate(stats: {
  keyword: string;
  totalListings: number;
  avgTopFavorites: number;
  uniqueShops: number;
}): { score: number; verdict: ProductHuntVerdict; reasons: string[] } {
  const wordCount = stats.keyword.trim().split(/\s+/).length;

  let demandPoints = 0;
  if (stats.totalListings >= 100 && stats.totalListings <= 5000)
    demandPoints = 30;
  else if (stats.totalListings >= 50 && stats.totalListings < 100)
    demandPoints = 20;
  else if (stats.totalListings > 5000 && stats.totalListings <= 15000)
    demandPoints = 15;
  else if (stats.totalListings > 15000) demandPoints = 5;
  else demandPoints = 3; // <50 = thin

  let favPoints = 0;
  if (stats.avgTopFavorites >= 100) favPoints = 25;
  else if (stats.avgTopFavorites >= 50) favPoints = 18;
  else if (stats.avgTopFavorites >= 20) favPoints = 12;
  else if (stats.avgTopFavorites >= 5) favPoints = 6;

  let diversityPoints = 0;
  if (stats.uniqueShops >= 8) diversityPoints = 25;
  else if (stats.uniqueShops >= 6) diversityPoints = 18;
  else if (stats.uniqueShops >= 4) diversityPoints = 10;
  else diversityPoints = 0;

  let longTailPoints = 0;
  if (wordCount >= 4) longTailPoints = 20;
  else if (wordCount === 3) longTailPoints = 14;
  else if (wordCount === 2) longTailPoints = 6;

  const score = demandPoints + favPoints + diversityPoints + longTailPoints;

  const verdict: ProductHuntVerdict =
    score >= 75
      ? "GREAT"
      : score >= 55
        ? "GOOD"
        : score >= 35
          ? "MAYBE"
          : "SKIP";

  // Diagnostic reasons — what's GOOD or BAD about this keyword
  const reasons: string[] = [];
  if (stats.totalListings < 50)
    reasons.push("Very thin market — only a handful of listings exist.");
  else if (stats.totalListings > 15000)
    reasons.push(`Saturated — ${stats.totalListings.toLocaleString()} listings already.`);
  if (stats.avgTopFavorites < 10)
    reasons.push("Top results have very few favorites — weak buyer demand.");
  else if (stats.avgTopFavorites >= 100)
    reasons.push(`Strong buyer demand — avg ${Math.round(stats.avgTopFavorites)} favorites in the top 10.`);
  if (stats.uniqueShops <= 3 && stats.uniqueShops > 0)
    reasons.push(`Top spots dominated by ${stats.uniqueShops} shops — hard to displace.`);
  else if (stats.uniqueShops >= 8)
    reasons.push(`Healthy field — ${stats.uniqueShops} different shops in the top 10.`);
  if (wordCount <= 2)
    reasons.push("Short-tail keyword — hard for a new shop to rank.");
  else if (wordCount >= 4)
    reasons.push(`Long-tail (${wordCount} words) — easier ranking opportunity.`);

  if (reasons.length === 0) {
    reasons.push(
      score >= 75
        ? "Healthy demand, reasonable competition, diverse field."
        : "Moderate opportunity — worth a deeper look.",
    );
  }

  return { score, verdict, reasons };
}

/**
 * Evaluate a single keyword candidate against live Etsy data. Returns
 * the scored ProductHuntResult or null if Etsy errored (we just drop
 * those silently — the scan moves on with whatever succeeded).
 */
async function evaluateKeyword(
  keyword: string,
): Promise<ProductHuntResult | null> {
  try {
    const { totalListings, results } = await searchActiveListingsWithCount(
      keyword,
      10,
    );

    const avgTopFavorites =
      results.length > 0
        ? results.reduce((s, r) => s + (r.num_favorers ?? 0), 0) /
          results.length
        : 0;

    // Unique shops in top 10. Some listings don't return shop_id — for
    // those we assume each one is its own shop (best-case diversity).
    // Listings WITH shop_id contribute to the unique-shop set; the rest
    // get counted as +1 each.
    const shopIdsWithId = new Set<number>();
    let withoutShopId = 0;
    for (const r of results) {
      if (r.shop_id) shopIdsWithId.add(r.shop_id);
      else withoutShopId += 1;
    }
    const uniqueShops = shopIdsWithId.size + withoutShopId;

    const { score, verdict, reasons } = scoreCandidate({
      keyword,
      totalListings,
      avgTopFavorites,
      uniqueShops,
    });

    return {
      keyword,
      totalListings,
      avgTopFavorites: Math.round(avgTopFavorites),
      uniqueShops,
      wordCount: keyword.trim().split(/\s+/).length,
      score,
      verdict,
      reasons,
      topListings: results.slice(0, 3).map((l: EtsyListing) => ({
        title: l.title,
        favorites: l.num_favorers ?? 0,
        listingId: l.listing_id,
        url: l.url,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Run a full scan from a seed keyword. Returns the ranked opportunities
 * + cost telemetry.
 *
 * Cost: 1 Haiku call (~$0.005) + 25 Etsy calls (free, ~7 quota slots
 * each at our 3.3 QPS bucket).
 */
export async function huntProducts(
  seedKeyword: string,
): Promise<ProductHuntResponse> {
  const startedAt = Date.now();
  const costAccum: CostAccumulator = createCostAccumulator();

  // Step 1: Haiku brainstorms 25 long-tail variants of the seed keyword
  const variants = await expandSearchVariants(
    {
      seedKeyword: seedKeyword.trim(),
      productType: seedKeyword.trim(),
    },
    costAccum,
  );

  // Always include the seed itself as a benchmark
  const candidates = Array.from(
    new Set([
      seedKeyword.trim().toLowerCase(),
      ...variants.map((v) => v.toLowerCase()),
    ]),
  ).filter((v) => v.length >= 3 && v.length <= 80);

  // Step 2: query Etsy for each candidate in parallel
  const settled = await Promise.all(candidates.map(evaluateKeyword));
  const evaluated = settled.filter(
    (s): s is ProductHuntResult => s !== null,
  );

  // Step 3: sort by score desc, then by demand for tiebreak
  evaluated.sort((a, b) => b.score - a.score || b.totalListings - a.totalListings);

  return {
    seedKeyword: seedKeyword.trim(),
    scanCount: candidates.length,
    evaluated: evaluated.length,
    totalCostUsd: costAccum.totalCostUsd,
    durationMs: Date.now() - startedAt,
    results: evaluated,
  };
}

// ─── Niche-based hunt (new Manual Hunting flow, May 16 2026) ────────

export interface AliPreview {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceUsd: number;
  marginUsd: number;
  rating?: number;
  orderCount?: number;
}

export interface NicheKeywordResult extends ProductHuntResult {
  /**
   * Top 3 AliExpress products for this keyword (only populated for
   * GREAT / GOOD verdicts to save API budget). MAYBE / SKIP rows
   * don't auto-fetch AE preview — user has to click through.
   */
  aliPreview?: AliPreview[];
}

export interface NicheCategoryResult {
  category: string;
  keywords: NicheKeywordResult[];
}

export interface NicheHuntResponse {
  niche: string;
  style?: string;
  audience?: string;
  scanCount: number; // total keywords evaluated across all categories
  totalCostUsd: number;
  durationMs: number;
  categories: NicheCategoryResult[];
}

/**
 * Map an AliExpress product to a lightweight preview with margin
 * computed via the team's stepped markup table.
 */
function toAliPreview(p: AliExpressProduct): AliPreview {
  const pricing = calculateEtsyPrice(p.priceMin);
  return {
    productId: p.productId,
    title: p.title,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    priceUsd: p.priceMin,
    marginUsd: pricing.markup, // by formula, profit per sale == markup
    rating: p.rating,
    orderCount: p.orderCount,
  };
}

/**
 * Run a Niche Hunt — the new Manual Hunting pipeline (May 16 2026).
 *
 * Flow:
 *   1. Haiku — niche → 5-8 shop categories (forced extras from the
 *      employee's shop profile are merged in too)
 *   2. For each category (parallel) — Haiku → 4-6 keywords
 *   3. For ALL keywords (parallel) — Etsy demand check + score
 *   4. For GREAT / GOOD keywords only — AliExpress top-3 preview
 *      with margin calc (skipped if no AE token provided)
 *
 * Cost: ~$0.01-0.015 per niche hunt (1 + ~6 Haiku calls).
 * Wall time: ~20-30s (mostly Etsy at 3.3 QPS).
 *
 * If `accessToken` is null, AE previews are skipped entirely — the
 * pipeline still works and returns keyword scores, just without
 * supplier-side data.
 */
export async function huntByNiche(opts: {
  niche: string;
  style?: string;
  audience?: string;
  extraCategories?: string[];
  accessToken?: string | null;
}): Promise<NicheHuntResponse> {
  const startedAt = Date.now();
  const accum = createCostAccumulator();
  const niche = opts.niche.trim();

  // Step 1: niche → categories
  const categories = await generateNicheCategories(
    {
      niche,
      style: opts.style,
      audience: opts.audience,
      extras: opts.extraCategories,
    },
    accum,
  );

  if (categories.length === 0) {
    return {
      niche,
      style: opts.style,
      audience: opts.audience,
      scanCount: 0,
      totalCostUsd: accum.totalCostUsd,
      durationMs: Date.now() - startedAt,
      categories: [],
    };
  }

  // Step 2: in parallel, generate keywords per category
  const perCategory = await Promise.all(
    categories.map(async (category) => {
      const keywords = await generateCategoryKeywords(
        {
          niche,
          category,
          style: opts.style,
          audience: opts.audience,
        },
        accum,
      );
      return { category, keywords };
    }),
  );

  // Step 3: flat list of (category, keyword) pairs, dedup keywords
  // globally (a keyword shouldn't appear in two categories)
  const seenKeywords = new Set<string>();
  const allPairs: Array<{ category: string; keyword: string }> = [];
  for (const { category, keywords } of perCategory) {
    for (const kw of keywords) {
      const lower = kw.toLowerCase();
      if (seenKeywords.has(lower)) continue;
      seenKeywords.add(lower);
      allPairs.push({ category, keyword: lower });
    }
  }

  // Step 4: evaluate every keyword in parallel against Etsy
  const evaluated = await Promise.all(
    allPairs.map(async (pair) => {
      const result = await evaluateKeyword(pair.keyword);
      if (!result) return null;
      return { ...pair, result };
    }),
  );

  // Step 5: for GREAT / GOOD keywords, fetch AliExpress preview
  // (skip if no token to avoid pointless API hits)
  const winners = evaluated.filter(
    (e): e is { category: string; keyword: string; result: ProductHuntResult } =>
      e !== null && (e.result.verdict === "GREAT" || e.result.verdict === "GOOD"),
  );

  const aliPreviewByKeyword = new Map<string, AliPreview[]>();
  if (opts.accessToken && winners.length > 0) {
    // Batch AE calls in groups of 5 so we don't blow the 3.3 QPS bucket
    // all at once. The token bucket inside the AE client handles the
    // rate limiting itself but batching keeps things tidy.
    const aeResults = await Promise.all(
      winners.map(async (w) => {
        try {
          const res = await searchProductsByKeyword(w.keyword, {
            accessToken: opts.accessToken!,
            pageSize: 5,
            sortBy: "orders_desc",
          });
          return {
            keyword: w.keyword,
            previews: res.products.slice(0, 3).map(toAliPreview),
          };
        } catch {
          return { keyword: w.keyword, previews: [] };
        }
      }),
    );
    for (const { keyword, previews } of aeResults) {
      aliPreviewByKeyword.set(keyword, previews);
    }
  }

  // Step 6: organize results back into category buckets, sorted by
  // score within each category
  const categoryMap = new Map<string, NicheKeywordResult[]>();
  for (const entry of evaluated) {
    if (!entry) continue;
    const enriched: NicheKeywordResult = {
      ...entry.result,
      aliPreview: aliPreviewByKeyword.get(entry.keyword),
    };
    const bucket = categoryMap.get(entry.category) ?? [];
    bucket.push(enriched);
    categoryMap.set(entry.category, bucket);
  }

  const categoryResults: NicheCategoryResult[] = [];
  for (const category of categories) {
    const items = categoryMap.get(category) ?? [];
    items.sort((a, b) => b.score - a.score);
    categoryResults.push({ category, keywords: items });
  }
  // Sort categories so ones with more GREAT/GOOD keywords surface first
  categoryResults.sort((a, b) => {
    const aWins = a.keywords.filter(
      (k) => k.verdict === "GREAT" || k.verdict === "GOOD",
    ).length;
    const bWins = b.keywords.filter(
      (k) => k.verdict === "GREAT" || k.verdict === "GOOD",
    ).length;
    return bWins - aWins;
  });

  return {
    niche,
    style: opts.style,
    audience: opts.audience,
    scanCount: evaluated.filter((e) => e !== null).length,
    totalCostUsd: accum.totalCostUsd,
    durationMs: Date.now() - startedAt,
    categories: categoryResults,
  };
}
