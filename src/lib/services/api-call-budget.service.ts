import { prisma } from "@/lib/prisma";
import { pktDateAsUtcMidnight } from "@/lib/services/seo-autopilot-quota.service";

/**
 * M12 — global per-day outbound API call ceiling.
 *
 * Etsy and AliExpress each share ONE app key with a ~5,000 calls/day hard cap.
 * The existing token buckets only smooth per-second QPS; nothing stops a runaway
 * in-request loop or a leaked key from burning the whole daily quota and
 * silently killing the live SEO tool for everyone. This adds an orthogonal
 * per-DAY circuit breaker, counted at the single fetch choke point each provider
 * funnels through.
 *
 * Caps are GENEROUS (90% of the 5K hard cap; real usage ~2,700/day) — this is a
 * breaker for abuse/runaways, not a throttle. Tune via the exported consts.
 */
export const ETSY_DAILY_CALL_CAP = 4500;
export const AE_DAILY_CALL_CAP = 4500;

export type ApiProvider = "etsy" | "aliexpress";

/**
 * Records one outbound call for `provider` on today's PKT day and returns the
 * running count for the day. Atomic upsert on the unique (provider, date) key
 * (same guarantee SeoAutopilotUsage relies on).
 *
 * IMPORTANT: callers MUST wrap this in try/catch and FAIL OPEN — treat any throw
 * (or a missing table pre-migration) as "under budget" so a counter blip can
 * never block a legitimate API call. See isOverApiBudget().
 */
export async function recordApiCall(provider: ApiProvider): Promise<number> {
  const date = pktDateAsUtcMidnight();
  const row = await prisma.apiCallBudget.upsert({
    where: { provider_date: { provider, date } },
    create: { provider, date, count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

/**
 * Increments the daily counter and returns true ONLY when this provider has
 * genuinely crossed its daily cap. FAIL-OPEN by construction: any error
 * (DB blip, table not yet migrated) is swallowed and returns false, so the
 * caller proceeds with the API call exactly as before.
 */
export async function isOverApiBudget(provider: ApiProvider): Promise<boolean> {
  const cap = provider === "etsy" ? ETSY_DAILY_CALL_CAP : AE_DAILY_CALL_CAP;
  try {
    const count = await recordApiCall(provider);
    return count > cap;
  } catch {
    return false; // FAIL OPEN — never block a real call on a counter error
  }
}
