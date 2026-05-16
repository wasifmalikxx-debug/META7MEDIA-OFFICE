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

/** How many AE products to ask for per niche per source. */
const PAGE_SIZE_TRENDING = 20;
const PAGE_SIZE_FRESH = 30;

/** Keep AE products in the dedupe window for this many days. A product
 * that trended yesterday is hidden today even if it still has high
 * volume — keeps the daily batch genuinely fresh. */
const DEDUPE_WINDOW_DAYS = 7;

/** Drop anything cheaper than this — sub-$0.50 AE listings are almost
 * always test/scam SKUs that hijack the volume sort. */
const MIN_PRICE_FLOOR = 0.5;

/** Drop anything more expensive than this — over-$300 items rarely make
 * sense for Etsy dropship and skew the page towards luxury outliers. */
const MAX_PRICE_CEILING = 300;

/** Minimum rating in stars (0-5 scale) for any product to make the cut.
 * 4.0 stars = 80% in AE's percentage rating shape. Products without
 * rating data are NOT filtered out (some legit new SKUs have no
 * reviews yet). */
const MIN_RATING_STARS = 4.0;

/** TRENDING: proven best-seller floor. Below this, "best-seller" is a
 * stretch — could be a one-time spike from a single influencer mention. */
const MIN_ORDERS_TRENDING = 50;

/** FRESH: lower bound = some real demand validation. Above zero so we
 * don't surface untested zero-sale SKUs. */
const MIN_ORDERS_FRESH = 5;

/** FRESH: upper bound = differentiates from "already viral." Anything
 * over 200 orders is already a known winner — show it in TRENDING. */
const MAX_ORDERS_FRESH = 200;

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
  "wholesale", "bulk", "factory", "b2b", "oem",
  "1pcs ", "10pcs", "100pcs", "5pcs ", "20pcs",
  "industrial", "professional grade", "heavy duty",
  "raw material", "loose beads", "loose stones",

  // ─ Mass-market hardware ─
  "vacuum cleaner", "blender", "mixer ", "juicer", "fryer",
  "drill", "saw ", "wrench", "screwdriver", "tool kit",
  "car accessory", "auto part", "motorcycle",
  "vape", "vaping", "ecig", "e-cig", "shisha", "hookah",
  "trimmer", "clipper", "razor", "shaver", "epilator",
  "treadmill", "dumbbell", "barbell",

  // ─ Cheap copies / counterfeit indicators ─
  "replica", "clone", "fake ", "knockoff", "1:1 copy",

  // ─ Adult / NSFW (off-brand for Etsy in our shops) ─
  "sex toy", "vibrator", "lingerie", "intimate", "g-spot",
];

/** Returns true if the title is safe for Etsy listing — clears the
 * blocklist and basic quality checks. */
function isEtsyFriendly(title: string): boolean {
  if (!title) return false;
  const trimmed = title.trim();
  if (trimmed.length < MIN_TITLE_LENGTH) return false;
  // Reject titles with untranslated Chinese characters — they'll look
  // unprofessional on Etsy. CJK range covers Chinese, Japanese kanji,
  // and Korean hanja; all three signal a botched translation pipeline.
  if (/[一-鿿]/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  for (const token of ETSY_HOSTILE_TOKENS) {
    if (lower.includes(token)) return false;
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
 * Single (niche, source) fetch + dedupe + insert. Exposed for tests +
 * the "Refresh now" button on the page (CEO-only).
 *
 * Filter behaviour depends on `source`:
 *   TRENDING → high-volume + 4★+
 *   FRESH    → low-but-validated volume + 4★+
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

  // Apply hard filters — basic field checks, price band, rating + orders
  const candidates: AliExpressProduct[] = [];
  let filteredOut = 0;
  for (const p of ae.products) {
    if (!passesBasicFilters(p)) {
      filteredOut += 1;
      continue;
    }
    if (!passesQualityFilters(p, source)) {
      filteredOut += 1;
      continue;
    }
    candidates.push(p);
  }

  // Dedupe against the last DEDUPE_WINDOW_DAYS for THIS niche+source.
  // Sources are deduped independently — a product that was in TRENDING
  // last Tuesday can still appear in FRESH this Monday (and vice versa).
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

  const fresh = candidates.filter((p) => !recentIds.has(String(p.productId)));
  const dedupedOut = candidates.length - fresh.length;

  // Upsert on the 4-col unique key (niche, aeProductId, fetchDate, source).
  // Re-runs of the same source on the same day refresh live fields without
  // breaking the claim state.
  let added = 0;
  for (const p of fresh) {
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
          // Re-fetch may show a price tick or order-count update — keep
          // the row but refresh the live fields. Claim state is preserved.
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

/** Source-specific rating + orders gate. */
function passesQualityFilters(
  p: AliExpressProduct,
  source: TrendingSource,
): boolean {
  // Rating filter: when AE didn't return rating, we keep the product
  // (some legit new SKUs have no reviews yet). When it did, demand 4★+.
  const stars = normalizeRatingToStars(p.rating);
  if (stars !== null && stars < MIN_RATING_STARS) return false;

  const orders = p.orderCount ?? 0;
  if (source === "TRENDING") {
    return orders >= MIN_ORDERS_TRENDING;
  }
  // FRESH — band: some validation, not yet popular
  return orders >= MIN_ORDERS_FRESH && orders <= MAX_ORDERS_FRESH;
}

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
 * Fetch today's batch for the given niches + source, grouped by niche.
 * Within each niche, unclaimed products surface first (CEO chose "stay
 * visible with badge" — unclaimed at the top keeps focus on what's
 * still up for grabs).
 *
 * If `niches` is empty, returns an empty array (employee hasn't picked
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
    orderBy: [
      // Unclaimed first (NULLs sort first by default in Postgres,
      // but Prisma defers — explicit ordering).
      { claimedAt: { sort: "asc", nulls: "first" } },
      // TRENDING: most-sold first (proven winners up top)
      // FRESH:    cheapest first (lowest barrier-to-list up top —
      //           order count is intentionally low across the board,
      //           so it's not a strong differentiator within fresh)
      ...(source === "TRENDING"
        ? ([{ ordersCount: "desc" as const }, { priceUsd: "asc" as const }])
        : ([{ priceUsd: "asc" as const }, { ordersCount: "desc" as const }])),
    ],
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
