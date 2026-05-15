/**
 * Opportunity Scanner — find underserved Etsy keywords for product
 * hunting on AliExpress.
 *
 * Given a seed category/product type, this:
 *   1. Asks Haiku to brainstorm ~25 long-tail variants
 *   2. Queries Etsy for each variant in parallel (top 10 + total count
 *      + unique shop count)
 *   3. Scores each on demand · engagement · diversity · long-tail
 *   4. Returns the top opportunities sorted by score
 *
 * The output drives the CEO Opportunity Scanner page — employees
 * should hunt AliExpress for the GREAT / GOOD keywords first.
 */

import {
  searchActiveListingsWithCount,
  type EtsyListing,
} from "./etsy-api.service";
import {
  expandSearchVariants,
  createCostAccumulator,
  type CostAccumulator,
} from "./anthropic.service";

export type OpportunityVerdict = "GREAT" | "GOOD" | "MAYBE" | "SKIP";

export interface OpportunityResult {
  keyword: string;
  totalListings: number; // saturation
  avgTopFavorites: number; // engagement signal
  uniqueShops: number; // top-10 diversity
  wordCount: number;
  score: number; // 0-100 composite
  verdict: OpportunityVerdict;
  reasons: string[];
  topListings: Array<{
    title: string;
    favorites: number;
    listingId: number;
    url?: string;
  }>;
}

export interface OpportunityScanResponse {
  seedKeyword: string;
  scanCount: number; // variants Haiku produced
  evaluated: number; // variants successfully scored (some may fail Etsy queries)
  totalCostUsd: number; // Anthropic only — Etsy is free
  durationMs: number;
  results: OpportunityResult[]; // sorted desc by score
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
export function scoreOpportunity(stats: {
  keyword: string;
  totalListings: number;
  avgTopFavorites: number;
  uniqueShops: number;
}): { score: number; verdict: OpportunityVerdict; reasons: string[] } {
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

  const verdict: OpportunityVerdict =
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
 * the scored OpportunityResult or null if Etsy errored (we just drop
 * those silently — the scan moves on with whatever succeeded).
 */
async function evaluateKeyword(
  keyword: string,
): Promise<OpportunityResult | null> {
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

    const { score, verdict, reasons } = scoreOpportunity({
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
export async function scanOpportunities(
  seedKeyword: string,
): Promise<OpportunityScanResponse> {
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
    (s): s is OpportunityResult => s !== null,
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
