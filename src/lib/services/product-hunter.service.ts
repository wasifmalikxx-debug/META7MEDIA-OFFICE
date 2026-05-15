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
  generateNicheBreakdown,
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

// ─── Niche-based hunt (May 16 2026 — v2: category-level products) ──

export interface CuratedProduct {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceUsd: number;
  recommendedEtsyPrice: number;
  marginUsd: number;
  marginPct: number;
  rating?: number;
  orderCount?: number;
  // Internal: which keyword surfaced this product (for debugging /
  // filtering — not shown in UI by default).
  matchedKeyword: string;
  /** Composite 0-100 score: orders × rating × margin */
  qualityScore: number;
}

/**
 * A keyword inside a category — has its own scored Etsy stats AND its
 * own list of quality-filtered AliExpress products. The UI renders one
 * card per keyword (no longer aggregates products to the category level
 * because the team wanted keyword visibility back, May 16 2026 update).
 */
/**
 * Lightweight one-product preview shown next to each keyword card —
 * lets the team SEE what kind of product a keyword refers to without
 * clicking through. Strict-matched so the preview always actually
 * represents the keyword (no off-topic mom-gifts when the keyword
 * is about jackets).
 */
export interface KeywordPreview {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceUsd: number;
  rating?: number;
  orderCount?: number;
}

export interface NicheKeywordResult {
  keyword: string;
  totalListings: number;
  avgTopFavorites: number;
  uniqueShops: number;
  score: number;
  verdict: ProductHuntVerdict;
  /** Kept for backward-compat (always [] in v2.5). Real preview is `preview`. */
  products: CuratedProduct[];
  /** Single representative AE product for visual context. Null if no AE match. */
  preview?: KeywordPreview;
}

export interface NicheCategoryResult {
  category: string;
  keywords: NicheKeywordResult[];
  /** Total products across all keywords in this category (post-dedup, post-filter). */
  totalProducts: number;
  /** How many of this category's keywords scored GREAT or GOOD on Etsy. */
  etsyHotKeywords: number;
  /** Total Etsy listing count summed across the category's keywords. */
  etsyTotalListings: number;
}

export interface NicheHuntResponse {
  niche: string;
  style?: string;
  audience?: string;
  scanCount: number;
  productCount: number;
  totalCostUsd: number;
  durationMs: number;
  categories: NicheCategoryResult[];
}

// ─── Product quality filters ───────────────────────────────────────
// Tuned for Etsy listing-ability: products must look professional,
// have proven demand on AliExpress, and a healthy margin after our
// markup table.

// Relaxed May 16 — too strict for clothing/home decor where many valid
// products have <50 orders or rate below 4.4. New thresholds keep the
// filter as a "noise cutoff" not a "perfectionist gate."
const PRODUCT_QUALITY = {
  minOrders: 15, // even 15 orders means real buyers vetted it
  minRating: 4.0, // 4.0+ is the "not actively bad" bar
  minMargin: 4, // $4/sale × 50 sales/month = enough to be worth listing
  maxPriceUsd: 80, // higher cap for clothing / home decor
  minTitleLength: 10,
};

function passesQualityFilter(p: AliExpressProduct, margin: number): boolean {
  if (!p.imageUrl) return false; // no image = unusable
  if (!p.title || p.title.length < PRODUCT_QUALITY.minTitleLength) return false;
  if (p.priceMin > PRODUCT_QUALITY.maxPriceUsd) return false;
  if (margin < PRODUCT_QUALITY.minMargin) return false;
  if (p.orderCount !== undefined && p.orderCount < PRODUCT_QUALITY.minOrders) {
    return false;
  }
  if (p.rating !== undefined && p.rating > 0 && p.rating < PRODUCT_QUALITY.minRating) {
    return false;
  }
  return true;
}

/**
 * Relevance filter — does the product's title contain any of the
 * category's product anchor terms? Stops "hand-stitched jacket gift
 * for mom" from returning generic mom-gift mugs that have nothing to
 * do with jackets.
 *
 * AliExpress's search algorithm matches popular tokens in long queries
 * (it prefers "gift for mom" over "hand-stitched jacket"), so we have
 * to post-filter at the title level.
 */
function passesRelevanceFilter(
  p: AliExpressProduct,
  productAnchors: string[],
): boolean {
  if (productAnchors.length === 0) return true; // no anchors = no filter
  if (!p.title) return false;
  const title = p.title.toLowerCase();
  return productAnchors.some((anchor) => title.includes(anchor));
}

// Words that contribute nothing to relevance (skip them when scoring)
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "your", "you", "this", "that",
  "are", "ours", "his", "her", "its", "their", "all", "any", "some",
  "set", "of", "in", "on", "to", "by", "a", "an", "is",
]);

/**
 * Strict keyword→title match score.
 *
 * Counts how many meaningful words from the keyword appear in the
 * product title. Higher = better match. We require both:
 *   1. At least one product anchor in the title
 *   2. At least half of the keyword's meaningful words in the title
 *
 * For keyword "y2k butterfly drop earrings" with title
 * "Y2K Butterfly Drop Earrings Korean Style" → all 4 words match → score 4.
 * For keyword "y2k butterfly drop earrings" with title
 * "Boho Hoop Earrings Gold Plated" → only "earrings" matches → fails.
 */
function strictMatchScore(title: string, keyword: string): number {
  const titleLower = title.toLowerCase();
  const keywordWords = keyword
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  let count = 0;
  for (const word of keywordWords) {
    if (titleLower.includes(word)) {
      count += 1;
      continue;
    }
    // Singular/plural variants
    if (word.endsWith("s") && titleLower.includes(word.slice(0, -1))) {
      count += 1;
      continue;
    }
    if (!word.endsWith("s") && titleLower.includes(word + "s")) {
      count += 1;
    }
  }
  return count;
}

/**
 * Pick the BEST one product preview for a keyword.
 *
 * Filter rule (gate):
 *   - Title MUST contain at least one of the category's product anchors
 *     (mask / earring / mug / etc.)
 *
 * Ranking rule (after gate, pick the best):
 *   - More keyword words matched in title = better
 *   - On ties, higher order count wins
 *
 * Returns the first valid product even if 0 keyword words match,
 * AS LONG AS the anchor matches. The anchor is the only hard gate —
 * keyword-word count is just the ranking signal. This gives us a
 * preview for nearly every keyword instead of empty cards.
 *
 * Returns null only if AE returned NO anchor-matching products at all.
 */
function pickBestPreview(
  products: AliExpressProduct[],
  keyword: string,
  anchors: string[],
): KeywordPreview | null {
  let best: { p: AliExpressProduct; score: number } | null = null;
  for (const p of products) {
    if (!p.imageUrl || !p.title || p.priceMin <= 0) continue;
    if (!passesRelevanceFilter(p, anchors)) continue;
    const score = strictMatchScore(p.title, keyword);
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        (p.orderCount ?? 0) > (best.p.orderCount ?? 0))
    ) {
      best = { p, score };
    }
  }
  if (!best) return null;
  const p = best.p;
  return {
    productId: p.productId,
    title: p.title,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    priceUsd: p.priceMin,
    rating: p.rating,
    orderCount: p.orderCount,
  };
}

/**
 * Composite quality score 0-100. Higher = better candidate to list.
 * Weights:
 *   - 40% margin (more profit per sale = more important)
 *   - 30% order count (proven demand)
 *   - 20% rating (quality signal)
 *   - 10% price sweet spot ($3-$25 is ideal for Etsy)
 */
function scoreProduct(p: AliExpressProduct, margin: number): number {
  let score = 0;

  // Margin: linear up to $20, capped
  score += Math.min(margin / 20, 1) * 40;

  // Orders: log-scale (50 → 10pts, 500 → 20pts, 5000 → 30pts)
  if (p.orderCount && p.orderCount > 0) {
    const orderPts = Math.min(Math.log10(p.orderCount + 1) / 4, 1) * 30;
    score += orderPts;
  }

  // Rating: 4.4 → 10pts, 4.7 → 16pts, 5.0 → 20pts
  if (p.rating !== undefined && p.rating > 0) {
    const ratingPts = Math.max(0, ((p.rating - 4) / 1) * 20);
    score += Math.min(ratingPts, 20);
  } else {
    score += 5; // mild neutral
  }

  // Price sweet spot: $3-$25 = 10pts, otherwise tapered
  const price = p.priceMin;
  if (price >= 3 && price <= 25) score += 10;
  else if (price >= 1 && price <= 35) score += 6;
  else if (price <= 50) score += 3;

  return Math.round(score);
}

function toCuratedProduct(
  p: AliExpressProduct,
  matchedKeyword: string,
): CuratedProduct {
  const pricing = calculateEtsyPrice(p.priceMin);
  const margin = pricing.markup;
  return {
    productId: p.productId,
    title: p.title,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    priceUsd: p.priceMin,
    recommendedEtsyPrice: pricing.etsyMatured,
    marginUsd: margin,
    marginPct:
      pricing.etsyMatured > 0
        ? (margin / pricing.etsyMatured) * 100
        : 0,
    rating: p.rating,
    orderCount: p.orderCount,
    matchedKeyword,
    qualityScore: scoreProduct(p, margin),
  };
}

/**
 * Run a Niche Hunt — v2 pipeline (May 16 2026, category-level products).
 *
 * Flow:
 *   1. Haiku — niche → 6-10 PROVEN-SELLING shop categories
 *   2. For each category (parallel) — Haiku → 6-8 buyer-intent keywords
 *   3. For ALL keywords (parallel) — Etsy demand check (validates the
 *      category actually has Etsy buyer traction)
 *   4. For ALL keywords (parallel) — AliExpress product fetch
 *      (20 products per keyword, sorted by orders desc)
 *   5. Aggregate products to category level — dedup by aliProductId,
 *      apply quality filter, sort by composite score, take top 12
 *   6. Drop categories with zero quality-filtered products
 *
 * Cost: ~$0.015-0.02 per niche hunt (1 + ~8 Haiku calls).
 * Wall time: ~25-35s (~40 Etsy + ~50 AE calls).
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

  console.log(`[hunt-by-niche] starting: "${niche}" (style=${opts.style ?? "—"}, audience=${opts.audience ?? "—"})`);

  // Step 1+2: ONE Haiku call returns categories AND their keywords
  // AND their product anchors (for title relevance filtering) in one
  // shot. Replaces the previous 11-call pipeline that cost ~$0.02 per
  // hunt — now ~$0.003.
  let perCategory: Array<{
    category: string;
    keywords: string[];
    productAnchors: string[];
  }> = [];
  try {
    perCategory = await generateNicheBreakdown(
      {
        niche,
        style: opts.style,
        audience: opts.audience,
        extras: opts.extraCategories,
      },
      accum,
    );
    console.log(
      `[hunt-by-niche] got ${perCategory.length} categories with ${perCategory.reduce((s, c) => s + c.keywords.length, 0)} total keywords`,
    );
  } catch (err) {
    console.error(
      `[hunt-by-niche] generateNicheBreakdown failed:`,
      err instanceof Error ? err.message : String(err),
    );
    perCategory = (opts.extraCategories ?? []).map((c) => {
      const lower = c.toLowerCase();
      return {
        category: c,
        keywords: [c],
        productAnchors: [lower, lower.replace(/s$/, "")],
      };
    });
  }

  if (perCategory.length === 0) {
    return {
      niche,
      style: opts.style,
      audience: opts.audience,
      scanCount: 0,
      productCount: 0,
      totalCostUsd: accum.totalCostUsd,
      durationMs: Date.now() - startedAt,
      categories: [],
    };
  }

  // Lookup map: category → productAnchors (used in product filter step)
  const anchorsByCategory = new Map<string, string[]>();
  for (const p of perCategory) {
    anchorsByCategory.set(p.category, p.productAnchors);
  }

  const categories = perCategory.map((p) => p.category);

  // Build flat (category, keyword) pairs with global keyword dedup
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

  // Step 3+4: Etsy demand check + AliExpress preview fetch — in PARALLEL.
  //
  // v2.5: one strict-match AE preview per keyword for visual context
  // (was removed in v2.4, brought back per user feedback). Both APIs
  // run concurrently so wall time = max(Etsy time, AE time), not sum.
  // At our 3.3 QPS bucket: ~64 keywords × 1 call each ≈ 20s per API,
  // running in parallel = ~20s total instead of 30s sequential.
  const previewByKeyword = new Map<string, KeywordPreview | null>();
  const fetchPreview = async (pair: { category: string; keyword: string }) => {
    if (!opts.accessToken) return null;
    try {
      // 20 candidates gives the relevance filter a wider net so we
      // almost always find at least one anchor-matching product to
      // surface as the preview.
      const res = await searchProductsByKeyword(pair.keyword, {
        accessToken: opts.accessToken,
        pageSize: 20,
        sortBy: "orders_desc",
      });
      const anchors = perCategory.find((c) => c.category === pair.category)
        ?.productAnchors ?? [];
      return pickBestPreview(res.products, pair.keyword, anchors);
    } catch {
      return null;
    }
  };

  const [etsyEvaluated, previewResults] = await Promise.all([
    Promise.all(
      allPairs.map(async (pair) => {
        const result = await evaluateKeyword(pair.keyword);
        return { ...pair, etsyResult: result };
      }),
    ),
    Promise.all(
      allPairs.map(async (pair) => ({
        keyword: pair.keyword,
        preview: await fetchPreview(pair),
      })),
    ),
  ]);

  for (const { keyword, preview } of previewResults) {
    previewByKeyword.set(keyword, preview);
  }

  // Step 5: Build category → keyword tree (no products this round).
  const categoryResults: NicheCategoryResult[] = [];
  for (const category of categories) {
    const categoryKeywords = etsyEvaluated.filter(
      (e) => e.category === category,
    );

    const keywordResults: NicheKeywordResult[] = [];
    for (const ck of categoryKeywords) {
      if (!ck.etsyResult) continue;
      keywordResults.push({
        keyword: ck.keyword,
        totalListings: ck.etsyResult.totalListings,
        avgTopFavorites: ck.etsyResult.avgTopFavorites,
        uniqueShops: ck.etsyResult.uniqueShops,
        score: ck.etsyResult.score,
        verdict: ck.etsyResult.verdict,
        products: [], // legacy field; real preview is `preview` below
        preview: previewByKeyword.get(ck.keyword) ?? undefined,
      });
    }

    if (keywordResults.length === 0) continue;

    // Sort keywords within the category by score desc
    keywordResults.sort((a, b) => b.score - a.score);

    const etsyHotKeywords = keywordResults.filter(
      (k) => k.verdict === "GREAT" || k.verdict === "GOOD",
    ).length;
    const etsyTotalListings = keywordResults.reduce(
      (sum, k) => sum + k.totalListings,
      0,
    );

    categoryResults.push({
      category,
      keywords: keywordResults,
      // v2.4: products dropped — `totalProducts` now means keyword count
      // (the UI uses it for the tab badge + summary). Renaming the field
      // would break the wire format, so we just repurpose it.
      totalProducts: keywordResults.length,
      etsyHotKeywords,
      etsyTotalListings,
    });
  }

  // Sort categories: most Etsy-hot keywords first, then by total
  // product count (more products = more options for the team).
  categoryResults.sort((a, b) => {
    if (a.etsyHotKeywords !== b.etsyHotKeywords) {
      return b.etsyHotKeywords - a.etsyHotKeywords;
    }
    return b.totalProducts - a.totalProducts;
  });

  const totalProductCount = categoryResults.reduce(
    (sum, c) => sum + c.totalProducts,
    0,
  );

  return {
    niche,
    style: opts.style,
    audience: opts.audience,
    scanCount: etsyEvaluated.filter((e) => e.etsyResult !== null).length,
    productCount: totalProductCount,
    totalCostUsd: accum.totalCostUsd,
    durationMs: Date.now() - startedAt,
    categories: categoryResults,
  };
}
