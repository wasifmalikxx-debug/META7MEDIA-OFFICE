import { prisma } from "@/lib/prisma";
import {
  searchByVolumeDesc,
  type AliExpressProduct,
} from "@/lib/services/aliexpress-api.service";
import { calculateEtsyPrice } from "@/lib/etsy-price-calculator";
import { listAllActiveNichesDistinct } from "@/lib/services/employee-niche.service";

/**
 * Daily Trending Products service.
 *
 * The cron at /api/cron/daily-trending calls `runDailyTrendingFetch` once
 * a day at 5 AM PKT. For every distinct active employee niche it:
 *   1. Asks AE for the top 20 highest-volume products (sortBy=orders_desc)
 *   2. Drops anything with a missing price/url/image (unrenderable)
 *   3. Drops anything we already saved in the last 7 days for this niche
 *      (so the page only shows truly NEW products each day)
 *   4. Pre-computes the suggested Etsy listing prices (matured + new shop)
 *      so the UI can render without reaching back to the calculator
 *   5. Bulk-inserts the survivors with fetchDate = today (PKT)
 *
 * The page reads from `DailyTrendingProduct` filtered to today's bucket —
 * no live AE calls per visit, so page loads are instant and free.
 */

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

/** How many AE products to ask for per niche. Higher than we need so
 * dedupe + price-floor filters still leave us with a healthy pool. */
const PAGE_SIZE_PER_NICHE = 20;

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

export interface NicheRunSummary {
  niche: string;
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
  perNiche: NicheRunSummary[];
}

/**
 * Run the full fetch pass. Caller (cron route) supplies the CEO's
 * AliExpress access token — the cron borrows the CEO's connection
 * because partners/employees aren't required to OAuth themselves.
 */
export async function runDailyTrendingFetch(opts: {
  accessToken: string;
}): Promise<DailyTrendingRunResult> {
  const startedAt = new Date();
  const fetchDate = todayInPkt();

  const niches = await listAllActiveNichesDistinct();
  const perNiche: NicheRunSummary[] = [];
  let productsAdded = 0;

  // Sequential per-niche to stay polite with AE rate limits + give us
  // tidy logs. ~30 niches × ~1.5s/call = ~45s total — well under the
  // 300s cron budget.
  for (const niche of niches) {
    try {
      const summary = await runNiche({
        niche,
        accessToken: opts.accessToken,
        fetchDate,
      });
      perNiche.push(summary);
      productsAdded += summary.added;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[daily-trending] ${niche} failed:`, reason);
      perNiche.push({
        niche,
        fetched: 0,
        added: 0,
        dedupedOut: 0,
        filteredOut: 0,
        error: reason,
      });
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
 * Single-niche fetch + dedupe + insert. Exposed for tests + the
 * "Refresh now" button on the page (CEO-only).
 */
export async function runNiche(opts: {
  niche: string;
  accessToken: string;
  fetchDate: Date;
}): Promise<NicheRunSummary> {
  const { niche, accessToken, fetchDate } = opts;

  const ae = await searchByVolumeDesc(niche, {
    accessToken,
    pageSize: PAGE_SIZE_PER_NICHE,
  });

  // Filter to renderable + sane-priced products
  const candidates: AliExpressProduct[] = [];
  let filteredOut = 0;
  for (const p of ae.products) {
    if (
      !p.productId ||
      !p.title ||
      !p.productUrl ||
      !p.imageUrl ||
      !p.priceMin ||
      p.priceMin < MIN_PRICE_FLOOR ||
      p.priceMin > MAX_PRICE_CEILING
    ) {
      filteredOut += 1;
      continue;
    }
    candidates.push(p);
  }

  // Dedupe against the last DEDUPE_WINDOW_DAYS for this niche
  const cutoff = new Date(
    fetchDate.getTime() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const aeIds = candidates.map((p) => String(p.productId));
  const recentRows = aeIds.length
    ? await prisma.dailyTrendingProduct.findMany({
        where: {
          niche,
          aeProductId: { in: aeIds },
          fetchDate: { gte: cutoff },
        },
        select: { aeProductId: true },
      })
    : [];
  const recentIds = new Set(recentRows.map((r) => r.aeProductId));

  const fresh = candidates.filter((p) => !recentIds.has(String(p.productId)));
  const dedupedOut = candidates.length - fresh.length;

  // Insert one-by-one via upsert to handle the (niche, aeProductId,
  // fetchDate) unique constraint cleanly when the cron is re-run on the
  // same day (e.g. CEO clicks "Refresh now").
  let added = 0;
  for (const p of fresh) {
    const pricing = calculateEtsyPrice(p.priceMin);
    try {
      await prisma.dailyTrendingProduct.upsert({
        where: {
          niche_aeProductId_fetchDate: {
            niche,
            aeProductId: String(p.productId),
            fetchDate,
          },
        },
        create: {
          niche,
          aeProductId: String(p.productId),
          title: p.title.slice(0, 300),
          imageUrl: p.imageUrl?.slice(0, 500) ?? null,
          priceUsd: p.priceMin,
          ordersCount: p.orderCount ?? null,
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
          suggestedEtsyMatured: round2(pricing.etsyMatured),
          suggestedEtsyNew: round2(pricing.etsyNew),
        },
      });
      added += 1;
    } catch (err) {
      console.warn(
        `[daily-trending] insert failed for ${niche} / ${p.productId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    niche,
    fetched: ae.products.length,
    added,
    dedupedOut,
    filteredOut,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Page-side queries ──────────────────────────────────────────────

export interface TrendingProductRow {
  id: string;
  niche: string;
  aeProductId: string;
  title: string;
  imageUrl: string | null;
  priceUsd: number;
  ordersCount: number | null;
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
 * Fetch today's batch for the given niches, grouped by niche.
 * Within each niche, claimed-by-someone-else products sink to the
 * bottom (CEO chose "stay visible with badge" — but unclaimed first
 * keeps focus on what's still up for grabs).
 *
 * If `niches` is empty, returns an empty array (employee hasn't picked
 * any niches yet — page shows the empty state).
 */
export async function getTodaysTrendingGrouped(
  niches: string[],
): Promise<NicheGroup[]> {
  if (niches.length === 0) return [];
  const fetchDate = todayInPkt();

  const rows = await prisma.dailyTrendingProduct.findMany({
    where: {
      fetchDate,
      niche: { in: niches },
    },
    orderBy: [
      // Unclaimed first (NULLs sort first by default in Postgres,
      // but Prisma defers — explicit ordering)
      { claimedAt: { sort: "asc", nulls: "first" } },
      { ordersCount: "desc" },
      { priceUsd: "asc" },
    ],
    select: {
      id: true,
      niche: true,
      aeProductId: true,
      title: true,
      imageUrl: true,
      priceUsd: true,
      ordersCount: true,
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
    if (list) list.push(row);
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
