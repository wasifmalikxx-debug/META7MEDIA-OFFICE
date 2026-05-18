/**
 * Product Hunter daily-usage quota.
 *
 * Mirrors SeoAutopilotUsage. Each hunt burns ~$0.02 Anthropic +
 * ~64 Etsy calls (out of 5K/day cap) + ~50 AliExpress calls — so a
 * per-user cap matters more for the shared Etsy / AE quota than the
 * dollar cost.
 *
 * Routes:
 *   - /api/seo-autopilot/hunt-by-niche  → checkAndConsume() before doing work
 *
 * One row per (userId, calendar day in Pakistan time). Calendar day
 * resets at PKT midnight. CEO (SUPER_ADMIN) bypasses; everyone else
 * is hard-capped at PRODUCT_HUNTER_DAILY_LIMIT hunts.
 */

import { prisma } from "@/lib/prisma";
import {
  pktDateAsUtcMidnight,
  nextPktMidnight,
} from "./seo-autopilot-quota.service";

export const PRODUCT_HUNTER_DAILY_LIMIT = 5;

export interface ProductHunterUsageSummary {
  count: number;
  limit: number;
  remaining: number;
  resetAt: string; // ISO
  isUnlimited: boolean;
  date: string; // PKT calendar date (YYYY-MM-DD)
}

/**
 * Read-only usage check — does NOT consume a slot. Used by the UI to
 * surface remaining quota and by the GET handler.
 */
export async function getProductHunterUsage(opts: {
  userId: string;
  isUnlimited: boolean;
}): Promise<ProductHunterUsageSummary> {
  const date = pktDateAsUtcMidnight();
  const row = await prisma.productHunterUsage.findUnique({
    where: { userId_date: { userId: opts.userId, date } },
  });
  const count = row?.count ?? 0;
  const limit = opts.isUnlimited
    ? Number.POSITIVE_INFINITY
    : PRODUCT_HUNTER_DAILY_LIMIT;
  const remaining = opts.isUnlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, PRODUCT_HUNTER_DAILY_LIMIT - count);
  return {
    count,
    limit,
    remaining,
    resetAt: nextPktMidnight().toISOString(),
    isUnlimited: opts.isUnlimited,
    date: date.toISOString().slice(0, 10),
  };
}

/**
 * Atomically reserve one quota slot. Returns the new count + remaining.
 * Throws ProductHunterQuotaExceededError if the user is already at
 * limit (only for non-unlimited users — CEO always succeeds).
 *
 * Called by /api/seo-autopilot/hunt-by-niche BEFORE the expensive
 * Claude + Etsy + AE work. Increment-then-rollback pattern handles
 * concurrent requests correctly under Postgres unique-constraint.
 */
export async function checkAndConsumeProductHunter(opts: {
  userId: string;
  isUnlimited: boolean;
}): Promise<ProductHunterUsageSummary> {
  const date = pktDateAsUtcMidnight();

  const updated = await prisma.productHunterUsage.upsert({
    where: { userId_date: { userId: opts.userId, date } },
    create: { userId: opts.userId, date, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (opts.isUnlimited) {
    return {
      count: updated.count,
      limit: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
      resetAt: nextPktMidnight().toISOString(),
      isUnlimited: true,
      date: date.toISOString().slice(0, 10),
    };
  }

  if (updated.count > PRODUCT_HUNTER_DAILY_LIMIT) {
    // Roll back the over-limit increment so the count stays accurate.
    await prisma.productHunterUsage.update({
      where: { userId_date: { userId: opts.userId, date } },
      data: { count: { decrement: 1 } },
    });
    throw new ProductHunterQuotaExceededError(
      PRODUCT_HUNTER_DAILY_LIMIT,
      nextPktMidnight(),
    );
  }

  return {
    count: updated.count,
    limit: PRODUCT_HUNTER_DAILY_LIMIT,
    remaining: Math.max(0, PRODUCT_HUNTER_DAILY_LIMIT - updated.count),
    resetAt: nextPktMidnight().toISOString(),
    isUnlimited: false,
    date: date.toISOString().slice(0, 10),
  };
}

export class ProductHunterQuotaExceededError extends Error {
  readonly limit: number;
  readonly resetAt: Date;
  constructor(limit: number, resetAt: Date) {
    super(`Daily Product Hunter limit reached (${limit}/${limit}).`);
    this.name = "ProductHunterQuotaExceededError";
    this.limit = limit;
    this.resetAt = resetAt;
  }
}
