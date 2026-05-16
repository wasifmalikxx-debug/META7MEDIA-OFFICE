import { prisma } from "@/lib/prisma";
import {
  searchByVolumeDesc,
  searchByVolumeAsc,
  type AliExpressProduct,
  type ProductSearchResponse,
} from "@/lib/services/aliexpress-api.service";
import { calculateEtsyPrice } from "@/lib/etsy-price-calculator";
import { listAllActiveNichesDistinct } from "@/lib/services/employee-niche.service";

/**
 * Daily Trending Products service.
 *
 * The cron at /api/cron/daily-trending calls `runDailyTrendingFetch` once
 * a day at 5 AM PKT. For every distinct active employee niche it runs
 * TWO passes — TRENDING (high-volume best-sellers) and FRESH (early-
 * momentum new listings) — and stores them as separate rows.
 *
 * Per-source filters (May 16 2026):
 *   TRENDING:
 *     - AE sort: orders_desc, pageSize 20
 *     - ordersCount >= 50  (proven best-seller)
 *     - ratingStars >= 4.0 (avoid 1-2-star outliers)
 *   FRESH:
 *     - AE sort: orders_asc, pageSize 30 (lower post-filter survival)
 *     - 5 <= ordersCount <= 200 (some validation, not yet popular)
 *     - ratingStars >= 4.0
 *
 * Shared filters (both sources):
 *   - Must have title + image + url + price
 *   - $0.50 <= price <= $300 (drop test SKUs + luxury outliers)
 *   - 7-day dedupe per niche+source (so daily batch is genuinely new)
 *
 * The page reads from `DailyTrendingProduct` filtered to today's bucket
 * + source — no live AE calls per visit, so loads are instant and free.
 */

/** Source of a row — drives which UI tab shows it. */
export type TrendingSource = "TRENDING" | "FRESH";

/** AE products are bucketed by date in Asia/Karachi. Page filters by this. */
export function todayInPkt(): Date {
  // Convert "now" to PKT (UTC+5) date components, then build a UTC
  // midnight Date for that PKT day. Stored with @db.Date so the time
  // portion is dropped at the DB layer regardless.
  const now = new Date();
  const pktMs = now.getTime() + 5 * 60 * 60 * 1000;
  const pktDate = new Date(pktMs);
  return new Date(
    Date.UTC(
      pktDate.getUTCFullYear(),
      pktDate.getUTCMonth(),
      pktDate.getUTCDate(),
    ),
  );
}

/** How many AE products to ask for per niche per source. Bumped May 16
 * 2026 (from 20/30 → 40/60 → 80/60) — TRENDING needs the largest pool
 * because after the Etsy-friendly blocklist + rating + min-orders
 * filters, only ~20-30% of AE's volume-desc top survives. 80 candidates
 * gives us comfortable headroom to hit the 5-per-niche target. */
const PAGE_SIZE_TRENDING = 80;
const PAGE_SIZE_FRESH = 60;

/** Keep AE products in the dedupe window for this many days. A product
 * that trended yesterday is hidden today even if it still has high
 * volume — keeps the daily batch genuinely fresh. */
const DEDUPE_WINDOW_DAYS = 7;

/** Price floor — CEO removed the meaningful filter (was $5) on May 16
 * 2026. Rationale: TRENDING should surface what's actually selling
 * regardless of cost. A $2 candle holder with 10k orders and 4.8 stars
 * is a more valuable signal than a $40 niche item with 12 orders.
 * Etsy markup formula handles the cost-to-price math elsewhere.
 *
 * $0.50 kept as a sanity floor only — sub-50¢ AE listings are almost
 * always test SKUs, scams, or "1 cent + shipping" tricks that would
 * crash our pricing math. */
const MIN_PRICE_FLOOR = 0.5;

/** Drop anything more expensive than this — over-$300 items rarely make
 * sense for Etsy dropship and skew the page towards luxury outliers. */
const MAX_PRICE_CEILING = 300;

/** Minimum rating in stars (0-5 scale) for any product to make the cut.
 * 4.0 stars = 80% in AE's percentage rating shape. Products without
 * rating data are NOT filtered out (some legit new SKUs have no
 * reviews yet). */
const MIN_RATING_STARS = 4.0;

/** TRENDING: minimum order count. Softened over the day 50 → 20 → 5.
 * At 5+ orders we have ~some demand validation, which combined with
 * the rating ≥ 4★ check is enough quality signal — the sort-by-score
 * pass at the end of runNiche pushes the actual best-sellers to the
 * top anyway, so a low floor just widens the pool. */
const MIN_ORDERS_TRENDING = 5;

/** Per-niche minimum item count we try to hit for TRENDING. If strict
 * filters leave us under this, we progressively soften the rating
 * threshold (4.0 → 3.5 → 3.0 → no rating filter) until we reach the
 * target or exhaust attempts. Etsy-friendly filter is NEVER softened
 * — bad-fit products stay blocked even when the niche is thin. */
const MIN_ITEMS_PER_NICHE = 5;

/** FRESH: lower bound = some real demand validation. Softened 5 → 3. */
const MIN_ORDERS_FRESH = 3;

/** FRESH: upper bound = differentiates from "already viral." Bumped
 * 200 → 500 so more emerging products qualify. */
const MAX_ORDERS_FRESH = 500;

/** Minimum title length. Sub-20-char titles on AE are usually badly
 * translated stubs or spam SKUs that look broken on Etsy listings. */
const MIN_TITLE_LENGTH = 20;

// ─── Etsy-friendliness keyword blocklist ────────────────────────────
//
// AE's volume sort surfaces mass-market products that don't fit Etsy's
// handmade/artisan aesthetic — generic tech accessories, branded
// counterfeits, wholesale bulk packs, industrial tools, etc. Any title
// containing one of these tokens gets filtered out.
//
// Match is case-insensitive substring on the lowercased title.
// Trailing spaces in some tokens (e.g. "lg ", "1pcs ") are intentional
// to avoid matching legitimate word fragments ("LGBT" wouldn't match
// "lg " because of the space).
//
// Maintained by hand — add new patterns when AE-junk keeps slipping
// through. The cron logs filteredOut count per niche so we can spot
// niches that need more blocklist work.

const ETSY_HOSTILE_TOKENS: ReadonlyArray<string> = [
  // ─ Brand names (almost always counterfeit on AE) ─
  "samsung", "apple", "iphone", "ipad", "macbook", "airpod",
  "huawei", "xiaomi", "redmi", "oppo", "vivo", "honor",
  "sony", "lg ", "panasonic", "philips", "bosch", "siemens",
  "nike", "adidas", "puma", "reebok", "champion",
  "louis vuitton", "gucci", "chanel", "rolex", "burberry",
  "disney", "marvel", "lego",

  // ─ Tech accessories — wrong aesthetic for Etsy ─
  "usb", "type-c", "type c ", "hdmi", "ethernet",
  "led strip", "led light", "led lamp", "led bar", "led ring",
  "wireless charger", "wifi", "5g ",
  "bluetooth speaker", "bluetooth earphone",
  "earphone", "earbud", "headset", "headphone", "airpods",
  "smartwatch", "smart watch", "fitness band", "fitness tracker",
  "power bank", "powerbank", "fast charger", "adapter",
  "router", "modem", "extender",
  "drone", "projector", "monitor", "webcam",
  "phone holder", "phone stand", "phone case", "ring light",
  "car charger", "car mount", "dash cam",

  // ─ Industrial / wholesale signals ─
  // Note: bulk-pack counts (15 PC, 50 pcs, etc.) are caught by the
  // regex pattern list below — no need to enumerate every "Npcs" here.
  "wholesale", "bulk", "factory", "b2b", "oem",
  "industrial", "professional grade", "heavy duty",
  "raw material", "loose beads", "loose stones",
  "spare part", "replacement part", "replacement leather",
  "luggage wheel", "suitcase wheel",

  // ─ Mass-market hardware ─
  "vacuum cleaner", "blender", "mixer ", "juicer", "fryer",
  "drill", "saw ", "wrench", "screwdriver", "tool kit",
  "car accessory", "auto part", "motorcycle",
  "vape", "vaping", "ecig", "e-cig", "shisha", "hookah",
  "trimmer", "clipper", "razor", "shaver", "epilator",
  "treadmill", "dumbbell", "barbell",

  // ─ Medical / surgical / vet equipment ─
  // Added May 16 2026 after "Animal Surgical Accessories Pet Vacuum"
  // slipped through. Pet niche should surface toys / beds / collars,
  // not vet-clinic gear.
  "surgical", "sterile", "medical grade", "clinical",
  "veterinary", "syringe", "scalpel", "stethoscope",

  // ─ Safety / PPE / industrial protective gear ─
  // Added May 16 2026 after "Full Face Protective Safe Mask, Anti Fog,
  // Anti Impact" slipped through the face-mask niche. Cloth/decorative
  // face masks are fine for Etsy; industrial respirators are not.
  // "facial shield" and "work protection" added same-day after
  // "Work Protection Mask Transparent Facial Shield" slipped through.
  "ppe", "hazmat", "respirator", "n95", "kn95", "n99",
  "welding", "welder", "grinder",
  "face shield", "facial shield", "transparent shield",
  "safety mask", "protective mask", "work protection",
  "full face protective", "full face safety",
  "anti fog", "anti-fog", "anti impact", "anti splash",
  "anti droplet", "anti-droplet", "anti virus", "anti-virus",
  "dust mask", "gas mask", "chemical mask",
  "safety glasses", "safety goggles",
  "safety helmet", "hard hat",
  "safety vest", "reflective vest", "hi-vis",
  "safety boots", "steel toe",

  // ─ Cheap copies / counterfeit indicators ─
  "replica", "clone", "fake ", "knockoff", "1:1 copy",

  // ─ Adult / NSFW (off-brand for Etsy in our shops) ─
  // "sexy" added May 16 2026 — softer than the explicit terms but
  // surfaces the wrong vibe for our artisan shops (e.g. "mesh see
  // through sexy shirt" slipped through mens-clothing niche).
  "sex toy", "vibrator", "lingerie", "intimate", "g-spot",
  "sexy ", " sexy", "see through", "see-through", "fetish",
];

/**
 * Regex patterns that catch dynamic junk indicators the static
 * substring list can't enumerate (every possible bulk-pack count,
 * randomized-pack signals, etc.). Case-insensitive.
 *
 * Added May 16 2026 after "Random 15 PC" + similar slipped through —
 * the substring list had "1pcs", "10pcs", "100pcs" but couldn't
 * cover every number that appears between them.
 */
const ETSY_HOSTILE_PATTERNS: ReadonlyArray<RegExp> = [
  // Bulk pack counts — "1pc", "15 PC", "100PCS", "50 pieces", etc.
  /\b\d+\s?pcs?\b/i,
  /\b\d+\s?pieces?\b/i,
  // "Random pack/color/set/mix" → commodity bulk indicator
  /\brandom\s+(pack|color|colors|set|mix|pcs?)\b/i,
  // Stock-count indicators that suggest commodity SKUs
  /\b(in stock|out of stock|min order)\b/i,
];

/** Returns true if the title is safe for Etsy listing — clears the
 * blocklist (substring + regex) and basic quality checks. */
function isEtsyFriendly(title: string): boolean {
  if (!title) return false;
  const trimmed = title.trim();
  if (trimmed.length < MIN_TITLE_LENGTH) return false;
  // Reject titles with untranslated Chinese characters — they'll look
  // unprofessional on Etsy. CJK range covers Chinese, Japanese kanji,
  // and Korean hanja; all three signal a botched translation pipeline.
  if (/[一-鿿]/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  // Cheap substring scan first — most rejections happen here.
  for (const token of ETSY_HOSTILE_TOKENS) {
    if (lower.includes(token)) return false;
  }
  // Then regex patterns for dynamic indicators (bulk-pack counts,
  // random-pack signals, etc.).
  for (const pattern of ETSY_HOSTILE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  return true;
}

export interface NicheRunSummary {
  niche: string;
  source: TrendingSource;
  fetched: number;
  added: number;
  dedupedOut: number;
  filteredOut: number;
  error?: string;
}

export interface DailyTrendingRunResult {
  startedAt: Date;
  finishedAt: Date;
  fetchDate: Date;
  nichesScanned: number;
  productsAdded: number;
  /** Per (niche, source) entry — 2× the niche count when both passes
   * run successfully (one TRENDING + one FRESH per niche). */
  perNiche: NicheRunSummary[];
}

/**
 * Run the full fetch pass — both TRENDING and FRESH per niche.
 * Caller (cron route) supplies the CEO's AliExpress access token; the
 * cron borrows the CEO's connection because partners/employees aren't
 * required to OAuth themselves.
 *
 * Cost: 2 AE calls per niche per day. At 15 niches that's 30 calls/day
 * — rounding error against the 5K daily AE cap.
 */
export async function runDailyTrendingFetch(opts: {
  accessToken: string;
}): Promise<DailyTrendingRunResult> {
  const startedAt = new Date();
  const fetchDate = todayInPkt();

  const niches = await listAllActiveNichesDistinct();
  const perNiche: NicheRunSummary[] = [];
  let productsAdded = 0;

  // Sequential per (niche, source) to stay polite with AE rate limits
  // + give us tidy logs. ~15 niches × 2 sources × ~1.5s/call = ~45s
  // total — well under the 300s cron budget.
  for (const niche of niches) {
    for (const source of ["TRENDING", "FRESH"] as TrendingSource[]) {
      try {
        const summary = await runNiche({
          niche,
          source,
          accessToken: opts.accessToken,
          fetchDate,
        });
        perNiche.push(summary);
        productsAdded += summary.added;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unknown";
        console.error(
          `[daily-trending] ${niche} (${source}) failed:`,
          reason,
        );
        perNiche.push({
          niche,
          source,
          fetched: 0,
          added: 0,
          dedupedOut: 0,
          filteredOut: 0,
          error: reason,
        });
      }
    }
  }

  const finishedAt = new Date();
  return {
    startedAt,
    finishedAt,
    fetchDate,
    nichesScanned: niches.length,
    productsAdded,
    perNiche,
  };
}

/**
 * Single (niche, source) fetch + filter + insert. Exposed for tests +
 * the "Refresh now" button on the page (CEO-only).
 *
 * Filter behaviour depends on `source`:
 *   TRENDING → high-volume best-sellers. Adaptive rating threshold
 *              (4.0 → 3.5 → 3.0 → none) so we always hit the per-niche
 *              minimum if AE has enough candidates. NO cross-day dedupe
 *              — same top sellers reappear daily, which is what the
 *              "trending" mental model expects.
 *   FRESH    → low-but-validated volume. Strict 4★ rating. 7-day
 *              dedupe so the page only shows genuinely new arrivals.
 *
 * Etsy-friendly blocklist is ALWAYS strict — bad-fit products never
 * surface regardless of how thin the niche is.
 */
export async function runNiche(opts: {
  niche: string;
  source: TrendingSource;
  accessToken: string;
  fetchDate: Date;
}): Promise<NicheRunSummary> {
  const { niche, source, accessToken, fetchDate } = opts;

  // Pick the AE sort + pageSize for this source
  let ae: ProductSearchResponse;
  if (source === "TRENDING") {
    ae = await searchByVolumeDesc(niche, {
      accessToken,
      pageSize: PAGE_SIZE_TRENDING,
    });
  } else {
    ae = await searchByVolumeAsc(niche, {
      accessToken,
      pageSize: PAGE_SIZE_FRESH,
    });
  }

  // First pass: strict filters (4★ rating, source-specific orders).
  // For TRENDING we then progressively soften the rating threshold
  // if we don't have at least MIN_ITEMS_PER_NICHE survivors. The
  // Etsy-friendly blocklist + basic field checks NEVER soften.
  let candidates = filterCandidates(ae.products, source, MIN_RATING_STARS);
  let filteredOut = ae.products.length - candidates.length;

  if (source === "TRENDING" && candidates.length < MIN_ITEMS_PER_NICHE) {
    for (const softerMin of [3.5, 3.0, 0]) {
      const next = filterCandidates(ae.products, source, softerMin);
      if (next.length >= MIN_ITEMS_PER_NICHE || softerMin === 0) {
        const gained = next.length - candidates.length;
        if (gained > 0) {
          console.log(
            `[daily-trending] ${niche} (${source}) softened rating to ${softerMin} → +${gained} items (now ${next.length})`,
          );
          filteredOut -= gained;
        }
        candidates = next;
        if (candidates.length >= MIN_ITEMS_PER_NICHE) break;
      }
    }
  }

  // Dedupe against the last DEDUPE_WINDOW_DAYS for this niche+source.
  // Applied to FRESH only — FRESH shows truly new arrivals, so a
  // product seen in the last week is intentionally hidden.
  //
  // TRENDING skips dedupe entirely: "show me today's best-sellers"
  // is the user expectation, and a product that's been #1 for 3 days
  // running should still appear on day 3. The page query filters by
  // fetchDate=today, so old rows naturally roll off.
  let toInsert = candidates;
  let dedupedOut = 0;
  if (source === "FRESH") {
    const cutoff = new Date(
      fetchDate.getTime() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const aeIds = candidates.map((p) => String(p.productId));
    const recentRows = aeIds.length
      ? await prisma.dailyTrendingProduct.findMany({
          where: {
            niche,
            source,
            aeProductId: { in: aeIds },
            fetchDate: { gte: cutoff },
          },
          select: { aeProductId: true },
        })
      : [];
    const recentIds = new Set(recentRows.map((r) => r.aeProductId));
    toInsert = candidates.filter(
      (p) => !recentIds.has(String(p.productId)),
    );
    dedupedOut = candidates.length - toInsert.length;
  }

  // Upsert on the 4-col unique key (niche, aeProductId, fetchDate, source).
  // Re-runs of the same source on the same day refresh live fields without
  // breaking the claim state.
  let added = 0;
  for (const p of toInsert) {
    const pricing = calculateEtsyPrice(p.priceMin);
    const ratingStars = normalizeRatingToStars(p.rating);
    try {
      await prisma.dailyTrendingProduct.upsert({
        where: {
          niche_aeProductId_fetchDate_source: {
            niche,
            aeProductId: String(p.productId),
            fetchDate,
            source,
          },
        },
        create: {
          niche,
          source,
          aeProductId: String(p.productId),
          title: p.title.slice(0, 300),
          imageUrl: p.imageUrl?.slice(0, 500) ?? null,
          priceUsd: p.priceMin,
          ordersCount: p.orderCount ?? null,
          ratingStars,
          productUrl: p.productUrl!.slice(0, 500),
          suggestedEtsyMatured: round2(pricing.etsyMatured),
          suggestedEtsyNew: round2(pricing.etsyNew),
          fetchDate,
        },
        update: {
          priceUsd: p.priceMin,
          ordersCount: p.orderCount ?? null,
          ratingStars,
          suggestedEtsyMatured: round2(pricing.etsyMatured),
          suggestedEtsyNew: round2(pricing.etsyNew),
        },
      });
      added += 1;
    } catch (err) {
      console.warn(
        `[daily-trending] insert failed for ${niche} / ${source} / ${p.productId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    niche,
    source,
    fetched: ae.products.length,
    added,
    dedupedOut,
    filteredOut,
  };
}

/**
 * Shared candidate-filter helper. Returns products that pass:
 *   1. Basic field checks + price floor + Etsy-friendly blocklist
 *   2. Rating threshold (when AE provides rating; null ratings pass IFF
 *      ratingMin is 0, i.e. the final softening pass)
 *   3. Source-specific order-count gate
 *
 * Called multiple times by runNiche to apply progressively softer
 * rating thresholds when a niche is thin.
 */
function filterCandidates(
  products: AliExpressProduct[],
  source: TrendingSource,
  ratingMin: number,
): AliExpressProduct[] {
  const out: AliExpressProduct[] = [];
  for (const p of products) {
    if (!passesBasicFilters(p)) continue;
    if (!passesQualityFiltersWithRating(p, source, ratingMin)) continue;
    out.push(p);
  }
  return out;
}

/** Variant of passesQualityFilters that takes an explicit rating
 * threshold (so runNiche can progressively soften it). */
function passesQualityFiltersWithRating(
  p: AliExpressProduct,
  source: TrendingSource,
  ratingMin: number,
): boolean {
  const stars = normalizeRatingToStars(p.rating);

  // Rating gate: when AE provides rating, require >= threshold.
  // When AE doesn't provide rating, allow only if threshold is 0
  // (final softening pass) — otherwise we'd surface unverified SKUs.
  if (stars !== null && stars < ratingMin) return false;
  if (stars === null && ratingMin > 0) {
    // No rating data — only let through if we have orders to back it
    const ord = p.orderCount;
    if (ord === null || ord === undefined || ord < 20) return false;
  }

  const orders = p.orderCount;
  if (orders === null || orders === undefined) {
    // No order data — already partially handled above. Pass at this
    // point only if rating is present (covered by the early return).
    return stars !== null;
  }

  if (source === "TRENDING") {
    return orders >= MIN_ORDERS_TRENDING;
  }
  return orders >= MIN_ORDERS_FRESH && orders <= MAX_ORDERS_FRESH;
}

// ─── Filters ────────────────────────────────────────────────────────

/** Universal field + price-band + Etsy-friendliness check. Same for
 * both sources. Etsy-friendliness is a title-only check (we can't
 * inspect product images at filter time), so it catches the obvious
 * tech/wholesale/brand pollution but isn't perfect. */
function passesBasicFilters(p: AliExpressProduct): boolean {
  if (
    !p.productId ||
    !p.title ||
    !p.productUrl ||
    !p.imageUrl ||
    !p.priceMin ||
    p.priceMin < MIN_PRICE_FLOOR ||
    p.priceMin > MAX_PRICE_CEILING
  ) {
    return false;
  }
  if (!isEtsyFriendly(p.title)) return false;
  return true;
}

// Note: the source-specific quality gate now lives in
// passesQualityFiltersWithRating above, which takes an explicit
// rating threshold so runNiche can progressively soften it for thin
// niches. The old fixed-threshold passesQualityFilters was removed
// (May 16 2026) — its only caller was migrated to the rating-aware
// variant.

/**
 * Normalize AE's mixed rating formats into a 0-5 star scale.
 *
 * AE returns rating as either:
 *   - percentage (e.g. "94.7%") → parsed by normalizeProduct as 94.7
 *   - 0-5 stars (e.g. "4.7")    → 4.7
 *   - 0-1 fraction (rare)        → 0.94 → treat as fraction
 *
 * Returns null if AE didn't include rating data (so filters can decide
 * whether to keep the product anyway).
 */
function normalizeRatingToStars(rating: number | undefined): number | null {
  if (rating === undefined || rating === null || isNaN(rating)) return null;
  if (rating <= 0) return null;
  // Percentage scale → divide by 20 to get stars
  if (rating > 5) return rating / 20;
  // Fraction scale → multiply by 5 to get stars
  if (rating < 1) return rating * 5;
  // Already in star scale
  return rating;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Page-side queries ──────────────────────────────────────────────

export interface TrendingProductRow {
  id: string;
  niche: string;
  source: TrendingSource;
  aeProductId: string;
  title: string;
  imageUrl: string | null;
  priceUsd: number;
  ordersCount: number | null;
  ratingStars: number | null;
  productUrl: string;
  suggestedEtsyMatured: number;
  suggestedEtsyNew: number;
  claimedById: string | null;
  claimedByName: string | null;
  claimedAt: Date | null;
}

export interface NicheGroup {
  niche: string;
  products: TrendingProductRow[];
}

/**
 * Compute a single "trend score" combining sales volume + rating.
 * Higher score = better trending pick.
 *
 *   score = ordersCount × (ratingStars / 5)
 *
 * A 1000-sales × 4.5★ product scores 900.
 * A 500-sales × 5★   product scores 500.
 * A 50-sales × 5★    product scores 50.
 *
 * Missing rating defaults to 4.0 (so a missing-rating product isn't
 * unfairly killed by being multiplied by zero). Missing orders defaults
 * to 0 (we should never surface a 0-orders product above one with orders).
 */
function trendScore(p: {
  ordersCount: number | null;
  ratingStars: number | null;
}): number {
  const orders = p.ordersCount ?? 0;
  const rating = p.ratingStars ?? 4.0;
  return orders * (rating / 5);
}

/**
 * Fetch today's batch for the given niches + source, grouped by niche.
 *
 * Sort order within each niche:
 *   1. Unclaimed first (claimed sinks so user focuses on what's free)
 *   2. By combined sales × rating score, desc (best trending up top)
 *   3. Cheapest first as tiebreaker
 *
 * Sorting happens in Node (not Prisma) because the combined score
 * isn't a DB column. Result sets are small (~30 rows × 8 niches max),
 * so the sort cost is trivial.
 *
 * If `niches` is empty, returns an empty array (user hasn't picked
 * any niches yet — page shows the empty state).
 */
export async function getTodaysTrendingGrouped(
  niches: string[],
  source: TrendingSource = "TRENDING",
): Promise<NicheGroup[]> {
  if (niches.length === 0) return [];
  const fetchDate = todayInPkt();

  const rows = await prisma.dailyTrendingProduct.findMany({
    where: {
      fetchDate,
      source,
      niche: { in: niches },
    },
    // Initial DB sort is just a stable order; the real sort happens
    // below in Node by combined trend score.
    orderBy: [{ ordersCount: "desc" }],
    select: {
      id: true,
      niche: true,
      source: true,
      aeProductId: true,
      title: true,
      imageUrl: true,
      priceUsd: true,
      ordersCount: true,
      ratingStars: true,
      productUrl: true,
      suggestedEtsyMatured: true,
      suggestedEtsyNew: true,
      claimedById: true,
      claimedByName: true,
      claimedAt: true,
    },
  });

  // Group by niche (preserve user-niche-list order)
  const groups = new Map<string, TrendingProductRow[]>();
  for (const niche of niches) groups.set(niche, []);
  for (const row of rows) {
    const list = groups.get(row.niche);
    // Prisma returns `source` as a generic string from the DB; cast
    // back to the discriminated union for callers.
    if (list)
      list.push({ ...row, source: row.source as TrendingSource });
  }

  // Sort each group by: unclaimed first → trend score desc → cheapest
  for (const [, products] of groups.entries()) {
    products.sort((a, b) => {
      // Unclaimed (claimedAt = null) sorts before claimed
      const aClaimed = a.claimedAt ? 1 : 0;
      const bClaimed = b.claimedAt ? 1 : 0;
      if (aClaimed !== bClaimed) return aClaimed - bClaimed;
      // Combined trend score (higher = better)
      const scoreDiff = trendScore(b) - trendScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      // Tiebreaker: cheaper first (easier listing, faster sale)
      return a.priceUsd - b.priceUsd;
    });
  }

  return [...groups.entries()].map(([niche, products]) => ({
    niche,
    products,
  }));
}

/**
 * Claim a product. Returns true on success, false if the product
 * is already claimed by someone else (race condition).
 */
export async function claimProduct(opts: {
  productId: string;
  userId: string;
  userName: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { productId, userId, userName } = opts;

  // Conditional update — only succeeds if claimedById is currently NULL.
  const result = await prisma.dailyTrendingProduct.updateMany({
    where: { id: productId, claimedById: null },
    data: {
      claimedById: userId,
      claimedByName: userName.slice(0, 120),
      claimedAt: new Date(),
    },
  });

  if (result.count === 0) {
    // Either the product doesn't exist, or it's already claimed.
    const existing = await prisma.dailyTrendingProduct.findUnique({
      where: { id: productId },
      select: { claimedByName: true },
    });
    if (!existing) return { ok: false, reason: "not_found" };
    return {
      ok: false,
      reason: `already_claimed:${existing.claimedByName ?? "another seller"}`,
    };
  }
  return { ok: true };
}

/**
 * Unclaim — only the original claimer (or CEO) can unclaim.
 * Returns true on success.
 */
export async function unclaimProduct(opts: {
  productId: string;
  userId: string;
  isCeo: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const product = await prisma.dailyTrendingProduct.findUnique({
    where: { id: opts.productId },
    select: { claimedById: true },
  });
  if (!product) return { ok: false, reason: "not_found" };
  if (!product.claimedById) return { ok: true }; // already unclaimed
  if (!opts.isCeo && product.claimedById !== opts.userId) {
    return { ok: false, reason: "not_owner" };
  }
  await prisma.dailyTrendingProduct.update({
    where: { id: opts.productId },
    data: {
      claimedById: null,
      claimedByName: null,
      claimedAt: null,
    },
  });
  return { ok: true };
}
