/**
 * SEO Autopilot daily-usage quota.
 *
 * One row per (userId, calendar day in Pakistan time). Calendar day
 * resets at PKT midnight. CEO (SUPER_ADMIN) bypasses the limit; everyone
 * else is hard-capped at SEO_AUTOPILOT_DAILY_LIMIT generations.
 *
 * Routes:
 *   - /api/seo-autopilot/generate  → checkAndConsume() before doing work
 *   - /api/seo-autopilot/usage     → getUsage() for the UI badge
 *   - /api/seo-autopilot/usage?stats=true (SUPER_ADMIN only)
 *                                  → getTeamStats() for the CEO panel
 */

import { prisma } from "@/lib/prisma";

export const SEO_AUTOPILOT_DAILY_LIMIT = 10;

/**
 * Returns the current calendar date in Pakistan (Asia/Karachi, UTC+5)
 * as a UTC-midnight Date suitable for DB storage with `@db.Date`. So
 * the value stored is "the calendar day from a Pakistan perspective"
 * regardless of where the server runs.
 */
export function pktDateAsUtcMidnight(now: Date = new Date()): Date {
  // en-CA formatter renders as "YYYY-MM-DD" — convenient and stable.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * Returns the UTC moment when the user's quota will next reset
 * (next PKT midnight). PKT = UTC + 5, so PKT midnight = previous-day
 * UTC 19:00. Tomorrow PKT midnight in real UTC time:
 *   pktDate of today  (UTC-midnight-of-PKT-calendar)
 *   + 24h
 *   - 5h  (because that UTC-midnight is 5h AHEAD of the actual PKT
 *          midnight moment, so we subtract to get the real instant)
 */
export function nextPktMidnight(now: Date = new Date()): Date {
  const todayAsUtcMidnight = pktDateAsUtcMidnight(now);
  const tomorrowAsUtcMidnight = new Date(
    todayAsUtcMidnight.getTime() + 24 * 60 * 60 * 1000,
  );
  return new Date(tomorrowAsUtcMidnight.getTime() - 5 * 60 * 60 * 1000);
}

/**
 * Returns the actual UTC moment when the CURRENT calendar month (in
 * Pakistan time) started. Used to filter "Your recent generations" to
 * month-to-date — list resets clean on the 1st of every PKT month.
 *
 * Example: if it's Nov 14 in PKT, returns the UTC instant for Nov 1
 * 00:00 PKT (= Oct 31 19:00 UTC). Anything with `createdAt >=` that is
 * "this month" in the user's mental model.
 */
export function pktCurrentMonthStartUtc(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const m = parseInt(parts.find((p) => p.type === "month")!.value, 10);
  // Day-1 in PKT (UTC+5) → subtract 5h from the day-1-at-UTC-midnight.
  return new Date(Date.UTC(y, m - 1, 1) - 5 * 60 * 60 * 1000);
}

/**
 * Returns the next PKT-month-start moment (when the history list will
 * next clear). For Nov 14 PKT, returns Dec 1 00:00 PKT in UTC.
 */
export function nextPktMonthStartUtc(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const m = parseInt(parts.find((p) => p.type === "month")!.value, 10);
  // Month after the current one (m is 1-indexed; Date.UTC takes 0-indexed)
  return new Date(Date.UTC(y, m, 1) - 5 * 60 * 60 * 1000);
}

/**
 * Human label for the current PKT month — used in the UI header so the
 * user sees "November 2026" instead of an opaque "this month".
 */
export function pktCurrentMonthLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi",
    month: "long",
    year: "numeric",
  }).format(now);
}

export interface UsageSummary {
  count: number;
  limit: number;
  remaining: number;
  resetAt: string; // ISO
  isUnlimited: boolean;
  date: string; // PKT calendar date (YYYY-MM-DD)
}

/**
 * Read-only usage check — does NOT consume a slot. Used by the UI to
 * render "X / 8 today" and by the GET /usage endpoint.
 */
export async function getUsage(opts: {
  userId: string;
  isUnlimited: boolean;
}): Promise<UsageSummary> {
  const date = pktDateAsUtcMidnight();
  const row = await prisma.seoAutopilotUsage.findUnique({
    where: { userId_date: { userId: opts.userId, date } },
  });
  const count = row?.count ?? 0;
  const limit = opts.isUnlimited ? Number.POSITIVE_INFINITY : SEO_AUTOPILOT_DAILY_LIMIT;
  const remaining = opts.isUnlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, SEO_AUTOPILOT_DAILY_LIMIT - count);
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
 * Throws QuotaExceededError if the user is already at limit (only for
 * non-unlimited users — unlimited users always succeed).
 *
 * This is called by /api/seo-autopilot/generate BEFORE the expensive
 * Sonnet calls. We increment-then-check rather than check-then-increment
 * because two simultaneous requests could otherwise both pass the check.
 *
 * Postgres upsert is atomic on the unique (userId, date) constraint.
 */
export async function checkAndConsume(opts: {
  userId: string;
  isUnlimited: boolean;
}): Promise<UsageSummary> {
  const date = pktDateAsUtcMidnight();

  // Atomic upsert + increment. Postgres guarantees no double-increment
  // even under high concurrency.
  const updated = await prisma.seoAutopilotUsage.upsert({
    where: { userId_date: { userId: opts.userId, date } },
    create: { userId: opts.userId, date, count: 1 },
    update: { count: { increment: 1 } },
  });

  // If the user is unlimited (CEO), allow regardless of count.
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

  // Over limit → roll back the increment we just did and throw. The
  // increment-then-rollback pattern means even racing requests get
  // counted correctly (only the first N pass, the rest roll back).
  if (updated.count > SEO_AUTOPILOT_DAILY_LIMIT) {
    await prisma.seoAutopilotUsage.update({
      where: { userId_date: { userId: opts.userId, date } },
      data: { count: { decrement: 1 } },
    });
    throw new QuotaExceededError(SEO_AUTOPILOT_DAILY_LIMIT, nextPktMidnight());
  }

  return {
    count: updated.count,
    limit: SEO_AUTOPILOT_DAILY_LIMIT,
    remaining: Math.max(0, SEO_AUTOPILOT_DAILY_LIMIT - updated.count),
    resetAt: nextPktMidnight().toISOString(),
    isUnlimited: false,
    date: date.toISOString().slice(0, 10),
  };
}

export class QuotaExceededError extends Error {
  readonly limit: number;
  readonly resetAt: Date;
  constructor(limit: number, resetAt: Date) {
    super(`Daily SEO Autopilot limit reached (${limit}/${limit}).`);
    this.name = "QuotaExceededError";
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

// ─── CEO usage stats ────────────────────────────────────────────────

export interface TeamUsageEntry {
  userId: string;
  employeeId: string;
  name: string;
  role: string;
  // Department this user belongs to (e.g. "Etsy - EM", "Etsy - AE").
  // "Unassigned" if the user has no department row OR doesn't match
  // an Etsy-prefixed employeeId.
  department: string;
  countToday: number;
  countYesterday: number;
  count7Day: number;
  isOverLimit: boolean;
  // Outcome breakdown for the last 7 days (computed from log entries)
  allowedCount: number;
  reviewCount: number;
  blockedCount: number;
  lastGeneratedAt: string | null;
  // Estimated USD spend over last 7 days (sum of per-event estimates)
  cost7DayUsd: number;
  costTodayUsd: number;
}

export interface DepartmentBreakdown {
  /** Display name e.g. "Etsy - EM" */
  name: string;
  /** Short tag e.g. "EM" (last segment of name, used for chips) */
  shortTag: string;
  /** Members of this department who have used Autopilot in last 7d */
  memberCount: number;
  /** Distinct active users today */
  activeUsersToday: number;
  countToday: number;
  count7Day: number;
  costTodayUsd: number;
  cost7DayUsd: number;
  allowedCount: number;
  reviewCount: number;
  blockedCount: number;
}

export interface RecentGeneration {
  id: string;
  userId: string;
  employeeId: string;
  userName: string;
  userRole: string;
  sourceTitle: string;
  generatedTitle: string | null;
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  category: string | null;
  createdAt: string; // ISO
  estimatedCostUsd: number;
}

export interface DailyTrendPoint {
  date: string; // PKT YYYY-MM-DD
  label: string; // "Mon", "Tue", "Today", "Yesterday"
  count: number;
  costUsd: number;
  allowedCount: number;
  reviewCount: number;
  blockedCount: number;
}

export interface CostByOutcome {
  allowedUsd: number;
  reviewUsd: number;
  blockedUsd: number;
  allowedCount: number;
  reviewCount: number;
  blockedCount: number;
}

export interface TeamStatsResponse {
  today: string; // PKT YYYY-MM-DD
  limit: number;
  totalToday: number;
  totalYesterday: number;
  total7Day: number;
  // Estimated USD spend across all users in each window — INCLUDES
  // both generation costs AND tag-swap suggestion costs (they're
  // separate API calls but the same Anthropic line item)
  costTodayUsd: number;
  costYesterdayUsd: number;
  cost7DayUsd: number;
  // Tag-swap specific metrics (subset of the cost totals above)
  tagSwapsToday: number;
  tagSwaps7Day: number;
  tagSwapCostTodayUsd: number;
  tagSwapCost7DayUsd: number;
  // Engagement / safety metrics for the top-of-dashboard KPI row
  activeUsersToday: number;
  activeUsers7Day: number;
  blockedToday: number;
  blocked7Day: number;
  avgCostPerGen7DayUsd: number;
  // Time-series + breakdowns for charts
  dailyTrend: DailyTrendPoint[]; // exactly 7 entries, oldest → newest
  costByOutcome7d: CostByOutcome;
  // Department-level breakdown (CEO dashboard only)
  departments: DepartmentBreakdown[];
  // Per-user + per-event detail (existing)
  entries: TeamUsageEntry[];
  recent: RecentGeneration[]; // newest first, capped at 50
}

/**
 * Resolve a user's department label for dashboard grouping. Uses the
 * actual Department.name when present; falls back to inferring from the
 * employeeId prefix so partners + users without a departmentId still
 * land in the right Etsy bucket.
 */
function resolveDepartmentLabel(
  departmentName: string | null | undefined,
  employeeId: string,
): string {
  if (departmentName && departmentName.trim().length > 0) {
    return departmentName;
  }
  // employeeId pattern: e.g. "EM-3", "AE-7", "ME-2" → "Etsy - EM" etc.
  const m = /^([A-Z]+)-/.exec(employeeId);
  if (m) {
    const prefix = m[1];
    if (prefix === "EM" || prefix === "AE" || prefix === "ME") {
      return `Etsy - ${prefix}`;
    }
    return prefix;
  }
  return "Unassigned";
}

// ─── Cost estimation ────────────────────────────────────────────────
//
// We don't ship per-call token tracking yet, so cost is derived from
// the verdict alone — same number every time for a given outcome.
// These are MID-RANGE estimates (between fully-cold and fully-warm)
// based on the cost analysis on May 14 2026:
//
//   ALLOWED / REVIEW: $0.044 cold ↔ $0.031 warm  →  estimate $0.040
//   BLOCKED:          $0.011 cold ↔ $0.005 warm  →  estimate $0.007
//
// These will be within ~20-25% of the real Anthropic invoice. For
// exact reconciliation, check the Anthropic console. We can swap to
// token-precise tracking later by adding an `estimatedCostUsd` column
// to SeoAutopilotLog and capturing usage from the SDK response.

const COST_ESTIMATE_USD = {
  ALLOWED: 0.04,
  REVIEW: 0.04,
  BLOCKED: 0.007,
} as const;

export function estimateGenerationCostUsd(verdict: string): number {
  return (
    COST_ESTIMATE_USD[verdict as keyof typeof COST_ESTIMATE_USD] ?? 0.04
  );
}

/**
 * Returns per-user usage stats for today + yesterday + 7-day rolling
 * + the latest 50 generation events for the CEO usage dashboard.
 * Sorted: usage entries desc by today's count; recent events newest-first.
 */
export async function getTeamStats(): Promise<TeamStatsResponse> {
  const today = pktDateAsUtcMidnight();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);

  // Run usage + log queries in parallel. We include department info on
  // both so we can group by dept without an extra query.
  const userSelect = {
    id: true,
    employeeId: true,
    firstName: true,
    lastName: true,
    role: true,
    department: { select: { name: true } },
  } as const;

  const [usageRows, logRows, swapRows] = await Promise.all([
    prisma.seoAutopilotUsage.findMany({
      where: { date: { gte: sevenDaysAgo } },
      include: { user: { select: userSelect } },
    }),
    prisma.seoAutopilotLog.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userSelect } },
    }),
    // Tag-swap suggestion calls — separate Anthropic spend that's
    // attributed to the same users; we roll their cost into the main
    // totals so the dashboard reflects the full invoice.
    prisma.seoAutopilotTagSwapLog.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      include: { user: { select: userSelect } },
    }),
  ]);

  const todayTime = today.getTime();
  const yesterdayTime = yesterday.getTime();

  // ─── Aggregate usage counts per user ────────────────────────────
  const byUser = new Map<
    string,
    {
      employeeId: string;
      name: string;
      role: string;
      department: string;
      countToday: number;
      countYesterday: number;
      count7Day: number;
      allowedCount: number;
      reviewCount: number;
      blockedCount: number;
      lastGeneratedAt: Date | null;
      cost7DayUsd: number;
      costTodayUsd: number;
    }
  >();

  for (const r of usageRows) {
    if (!r.user) continue;
    const key = r.userId;
    const entry =
      byUser.get(key) ??
      {
        employeeId: r.user.employeeId,
        name: `${r.user.firstName} ${r.user.lastName}`.trim(),
        role: r.user.role,
        department: resolveDepartmentLabel(
          r.user.department?.name,
          r.user.employeeId,
        ),
        countToday: 0,
        countYesterday: 0,
        count7Day: 0,
        allowedCount: 0,
        reviewCount: 0,
        blockedCount: 0,
        lastGeneratedAt: null,
        cost7DayUsd: 0,
        costTodayUsd: 0,
      };
    const t = r.date.getTime();
    if (t === todayTime) entry.countToday += r.count;
    if (t === yesterdayTime) entry.countYesterday += r.count;
    entry.count7Day += r.count;
    byUser.set(key, entry);
  }

  // ─── Layer in log-derived verdict breakdown + cost + last-gen ───
  // Track per-day cost + count + outcome buckets in one pass through
  // logRows. Cheaper than separate aggregate queries.

  // Build a fixed 7-day window (oldest → newest) so the trend chart
  // always renders 7 bars even if there are zero gens on some days.
  const dailyBuckets = new Map<
    number,
    {
      date: Date;
      count: number;
      costUsd: number;
      allowedCount: number;
      reviewCount: number;
      blockedCount: number;
    }
  >();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayTime - i * 24 * 60 * 60 * 1000);
    dailyBuckets.set(d.getTime(), {
      date: d,
      count: 0,
      costUsd: 0,
      allowedCount: 0,
      reviewCount: 0,
      blockedCount: 0,
    });
  }

  // Per-day cost totals
  let costTodayUsd = 0;
  let costYesterdayUsd = 0;
  let cost7DayUsd = 0;

  // Per-outcome aggregates across the 7-day window
  let totalAllowedCost = 0;
  let totalReviewCost = 0;
  let totalBlockedCost = 0;
  let totalAllowedCount = 0;
  let totalReviewCount = 0;
  let totalBlockedCount = 0;
  let totalBlockedToday = 0;

  // Distinct active users per window
  const activeUserIdsToday = new Set<string>();
  const activeUserIds7Day = new Set<string>();

  for (const log of logRows) {
    if (!log.user) continue;
    // Prefer the actual Anthropic invoice cost captured at generate
    // time. Falls back to the verdict-based estimate only for old log
    // rows written before token tracking was added.
    const logCost =
      typeof log.actualCostUsd === "number" && log.actualCostUsd > 0
        ? log.actualCostUsd
        : estimateGenerationCostUsd(log.verdict);
    // Anchor the log to a PKT calendar day (UTC midnight of that day).
    const logDayUtcMidnight = pktDateAsUtcMidnight(log.createdAt);
    const logDayTime = logDayUtcMidnight.getTime();
    cost7DayUsd += logCost;
    if (logDayTime === todayTime) costTodayUsd += logCost;
    if (logDayTime === yesterdayTime) costYesterdayUsd += logCost;

    // Per-day bucket
    const bucket = dailyBuckets.get(logDayTime);
    if (bucket) {
      bucket.count += 1;
      bucket.costUsd += logCost;
      if (log.verdict === "ALLOWED") bucket.allowedCount += 1;
      else if (log.verdict === "REVIEW") bucket.reviewCount += 1;
      else if (log.verdict === "BLOCKED") bucket.blockedCount += 1;
    }

    // Outcome totals
    if (log.verdict === "ALLOWED") {
      totalAllowedCost += logCost;
      totalAllowedCount += 1;
    } else if (log.verdict === "REVIEW") {
      totalReviewCost += logCost;
      totalReviewCount += 1;
    } else if (log.verdict === "BLOCKED") {
      totalBlockedCost += logCost;
      totalBlockedCount += 1;
      if (logDayTime === todayTime) totalBlockedToday += 1;
    }

    // Engagement
    activeUserIds7Day.add(log.userId);
    if (logDayTime === todayTime) activeUserIdsToday.add(log.userId);

    const entry = byUser.get(log.userId);
    if (!entry) {
      // User has a log row but no usage row — possible if usage row got
      // deleted manually. Synthesize an entry so they still show up.
      byUser.set(log.userId, {
        employeeId: log.user.employeeId,
        name: `${log.user.firstName} ${log.user.lastName}`.trim(),
        role: log.user.role,
        department: resolveDepartmentLabel(
          log.user.department?.name,
          log.user.employeeId,
        ),
        countToday: 0,
        countYesterday: 0,
        count7Day: 0,
        allowedCount: log.verdict === "ALLOWED" ? 1 : 0,
        reviewCount: log.verdict === "REVIEW" ? 1 : 0,
        blockedCount: log.verdict === "BLOCKED" ? 1 : 0,
        lastGeneratedAt: log.createdAt,
        cost7DayUsd: logCost,
        costTodayUsd: logDayTime === todayTime ? logCost : 0,
      });
      continue;
    }
    if (log.verdict === "ALLOWED") entry.allowedCount += 1;
    else if (log.verdict === "REVIEW") entry.reviewCount += 1;
    else if (log.verdict === "BLOCKED") entry.blockedCount += 1;
    entry.cost7DayUsd += logCost;
    if (logDayTime === todayTime) entry.costTodayUsd += logCost;
    if (!entry.lastGeneratedAt || log.createdAt > entry.lastGeneratedAt) {
      entry.lastGeneratedAt = log.createdAt;
    }
  }

  // ─── Roll tag-swap costs into the same totals ───────────────────
  // Swap logs don't have a verdict / outcome — they only contribute to
  // the cost numbers and the swap-specific counters. We bucket their
  // cost into dailyTrend + per-user totals + global totals so the
  // dashboard reflects every Anthropic dollar, not just generations.
  let tagSwapsToday = 0;
  let tagSwaps7Day = 0;
  let tagSwapCostTodayUsd = 0;
  let tagSwapCost7DayUsd = 0;

  for (const swap of swapRows) {
    if (!swap.user) continue;
    const swapCost =
      typeof swap.actualCostUsd === "number" && swap.actualCostUsd > 0
        ? swap.actualCostUsd
        : 0; // never estimate — swaps without tracked cost just don't count
    const swapDayUtcMidnight = pktDateAsUtcMidnight(swap.createdAt);
    const swapDayTime = swapDayUtcMidnight.getTime();

    tagSwaps7Day += 1;
    tagSwapCost7DayUsd += swapCost;
    if (swapDayTime === todayTime) {
      tagSwapsToday += 1;
      tagSwapCostTodayUsd += swapCost;
    }

    // Roll into global cost totals
    cost7DayUsd += swapCost;
    if (swapDayTime === todayTime) costTodayUsd += swapCost;
    if (swapDayTime === yesterdayTime) costYesterdayUsd += swapCost;

    // Roll into per-day bucket (chart still shows generation count
    // separately; cost rolls in so trend chart cost is total cost)
    const bucket = dailyBuckets.get(swapDayTime);
    if (bucket) bucket.costUsd += swapCost;

    // Roll into per-user totals — swap costs attribute to the user
    // who triggered the swap, even if they have no main gen row yet
    const entry = byUser.get(swap.userId);
    if (entry) {
      entry.cost7DayUsd += swapCost;
      if (swapDayTime === todayTime) entry.costTodayUsd += swapCost;
    } else {
      byUser.set(swap.userId, {
        employeeId: swap.user.employeeId,
        name: `${swap.user.firstName} ${swap.user.lastName}`.trim(),
        role: swap.user.role,
        department: resolveDepartmentLabel(
          swap.user.department?.name,
          swap.user.employeeId,
        ),
        countToday: 0,
        countYesterday: 0,
        count7Day: 0,
        allowedCount: 0,
        reviewCount: 0,
        blockedCount: 0,
        lastGeneratedAt: null,
        cost7DayUsd: swapCost,
        costTodayUsd: swapDayTime === todayTime ? swapCost : 0,
      });
    }
  }

  const entries: TeamUsageEntry[] = Array.from(byUser.entries())
    .map(([userId, v]) => ({
      userId,
      employeeId: v.employeeId,
      name: v.name,
      role: v.role,
      department: v.department,
      countToday: v.countToday,
      countYesterday: v.countYesterday,
      count7Day: v.count7Day,
      allowedCount: v.allowedCount,
      reviewCount: v.reviewCount,
      blockedCount: v.blockedCount,
      lastGeneratedAt: v.lastGeneratedAt?.toISOString() ?? null,
      cost7DayUsd: v.cost7DayUsd,
      costTodayUsd: v.costTodayUsd,
      isOverLimit:
        v.role !== "SUPER_ADMIN" && v.countToday >= SEO_AUTOPILOT_DAILY_LIMIT,
    }))
    .sort(
      (a, b) =>
        b.countToday - a.countToday ||
        b.count7Day - a.count7Day ||
        a.name.localeCompare(b.name),
    );

  // ─── Aggregate per-department breakdown ─────────────────────────
  const byDept = new Map<
    string,
    {
      memberCount: number;
      activeUserIdsToday: Set<string>;
      countToday: number;
      count7Day: number;
      costTodayUsd: number;
      cost7DayUsd: number;
      allowedCount: number;
      reviewCount: number;
      blockedCount: number;
    }
  >();
  for (const e of entries) {
    const cur =
      byDept.get(e.department) ??
      {
        memberCount: 0,
        activeUserIdsToday: new Set<string>(),
        countToday: 0,
        count7Day: 0,
        costTodayUsd: 0,
        cost7DayUsd: 0,
        allowedCount: 0,
        reviewCount: 0,
        blockedCount: 0,
      };
    cur.memberCount += 1;
    if (e.countToday > 0) cur.activeUserIdsToday.add(e.userId);
    cur.countToday += e.countToday;
    cur.count7Day += e.count7Day;
    cur.costTodayUsd += e.costTodayUsd;
    cur.cost7DayUsd += e.cost7DayUsd;
    cur.allowedCount += e.allowedCount;
    cur.reviewCount += e.reviewCount;
    cur.blockedCount += e.blockedCount;
    byDept.set(e.department, cur);
  }
  const departments: DepartmentBreakdown[] = Array.from(byDept.entries())
    .map(([name, d]) => {
      // Short tag = last word after the dash, e.g. "Etsy - EM" → "EM"
      const parts = name.split(" - ");
      const shortTag = parts.length > 1 ? parts[parts.length - 1] : name;
      return {
        name,
        shortTag,
        memberCount: d.memberCount,
        activeUsersToday: d.activeUserIdsToday.size,
        countToday: d.countToday,
        count7Day: d.count7Day,
        costTodayUsd: d.costTodayUsd,
        cost7DayUsd: d.cost7DayUsd,
        allowedCount: d.allowedCount,
        reviewCount: d.reviewCount,
        blockedCount: d.blockedCount,
      };
    })
    .sort(
      (a, b) =>
        b.count7Day - a.count7Day || a.name.localeCompare(b.name),
    );

  // ─── Cap recent events at 50 newest ─────────────────────────────
  const recent: RecentGeneration[] = logRows.slice(0, 50).map((l) => ({
    id: l.id,
    userId: l.userId,
    employeeId: l.user?.employeeId ?? "—",
    userName:
      l.user
        ? `${l.user.firstName} ${l.user.lastName}`.trim()
        : "Unknown user",
    userRole: l.user?.role ?? "EMPLOYEE",
    sourceTitle: l.sourceTitle,
    generatedTitle: l.generatedTitle,
    verdict: (l.verdict === "REVIEW"
      ? "REVIEW"
      : l.verdict === "BLOCKED"
        ? "BLOCKED"
        : "ALLOWED") as RecentGeneration["verdict"],
    category: l.category,
    createdAt: l.createdAt.toISOString(),
    // Actual Anthropic cost when available, else verdict-based estimate
    estimatedCostUsd:
      typeof l.actualCostUsd === "number" && l.actualCostUsd > 0
        ? l.actualCostUsd
        : estimateGenerationCostUsd(l.verdict),
  }));

  // ─── Build daily-trend series (oldest → newest, 7 points) ──────
  const sortedBuckets = Array.from(dailyBuckets.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const dailyTrend: DailyTrendPoint[] = sortedBuckets.map((b) => {
    const t = b.date.getTime();
    let label: string;
    if (t === todayTime) label = "Today";
    else if (t === yesterdayTime) label = "Yest.";
    else
      label = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Karachi",
        weekday: "short",
      }).format(b.date);
    return {
      date: b.date.toISOString().slice(0, 10),
      label,
      count: b.count,
      costUsd: b.costUsd,
      allowedCount: b.allowedCount,
      reviewCount: b.reviewCount,
      blockedCount: b.blockedCount,
    };
  });

  const total7DayCount = entries.reduce((s, e) => s + e.count7Day, 0);
  const totalTodayCount = entries.reduce((s, e) => s + e.countToday, 0);

  return {
    today: today.toISOString().slice(0, 10),
    limit: SEO_AUTOPILOT_DAILY_LIMIT,
    totalToday: totalTodayCount,
    totalYesterday: entries.reduce((s, e) => s + e.countYesterday, 0),
    total7Day: total7DayCount,
    costTodayUsd,
    costYesterdayUsd,
    cost7DayUsd,
    tagSwapsToday,
    tagSwaps7Day,
    tagSwapCostTodayUsd,
    tagSwapCost7DayUsd,
    activeUsersToday: activeUserIdsToday.size,
    activeUsers7Day: activeUserIds7Day.size,
    blockedToday: totalBlockedToday,
    blocked7Day: totalBlockedCount,
    avgCostPerGen7DayUsd:
      total7DayCount > 0
        ? (cost7DayUsd - tagSwapCost7DayUsd) /
          Math.max(1, total7DayCount)
        : 0,
    dailyTrend,
    costByOutcome7d: {
      allowedUsd: totalAllowedCost,
      reviewUsd: totalReviewCost,
      blockedUsd: totalBlockedCost,
      allowedCount: totalAllowedCount,
      reviewCount: totalReviewCount,
      blockedCount: totalBlockedCount,
    },
    departments,
    entries,
    recent,
  };
}

/**
 * Insert a per-event log row. Called by /api/seo-autopilot/generate
 * right after the slot becomes permanent (i.e. won't be refunded).
 *
 * The actualCostUsd + token columns come from the request's
 * CostAccumulator (anthropic.service.ts). When present they replace the
 * verdict-based estimate for everything downstream — dashboard totals,
 * per-user spend, etc. Old log rows have nulls here and continue to
 * use the estimate.
 *
 * Best-effort: any failure is swallowed — logging must never break a
 * successful generation.
 */
/**
 * Shape of the full listing snapshot we persist for user history.
 * Stored as a JSON column so adding fields later doesn't need a
 * migration. Null on BLOCKED.
 */
export interface SavedListing {
  title: string;
  description: string;
  tags: string[];
  altTexts: string[];
  rationale: {
    keywordFocus: string;
    titleStrategy: string;
    audienceHook: string;
  };
  categoryPath: string;
  categoryId: number;
  searchKeyword: string;
  productType: string;
  audienceHint: string;
  styleHint: string;
}

export async function logGeneration(opts: {
  userId: string;
  sourceTitle: string;
  generatedTitle: string | null;
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  category: string | null;
  actualCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  // Full listing snapshot — saved for 30-day user history view
  listing?: SavedListing | null;
  sizes?: string[];
  variants?: string[];
}): Promise<void> {
  try {
    await prisma.seoAutopilotLog.create({
      data: {
        userId: opts.userId,
        sourceTitle: opts.sourceTitle.slice(0, 500),
        generatedTitle: opts.generatedTitle?.slice(0, 160) ?? null,
        verdict: opts.verdict,
        category: opts.category?.slice(0, 200) ?? null,
        actualCostUsd: opts.actualCostUsd ?? null,
        inputTokens: opts.inputTokens ?? null,
        outputTokens: opts.outputTokens ?? null,
        cacheReadTokens: opts.cacheReadTokens ?? null,
        cacheWriteTokens: opts.cacheWriteTokens ?? null,
        // Prisma's Json column accepts any serializable value
        listingJson: (opts.listing ?? null) as never,
        sizes: opts.sizes ?? [],
        variants: opts.variants ?? [],
      },
    });
  } catch {
    // Silent — never fail a generation because audit logging failed.
  }
}

/**
 * Insert a tag-swap-suggestion log row. Each row represents one Haiku
 * call that produced 3 alternative tags — the user may pick one or
 * none, either way the call cost real tokens that we need to attribute.
 *
 * Best-effort: never break the swap-tag response if logging fails.
 */
export async function logTagSwap(opts: {
  userId: string;
  currentTag: string;
  suggestedTags: string[];
  reason?: string | null;
  actualCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): Promise<void> {
  try {
    await prisma.seoAutopilotTagSwapLog.create({
      data: {
        userId: opts.userId,
        currentTag: opts.currentTag.slice(0, 50),
        suggestedTags: opts.suggestedTags.slice(0, 5),
        reason: opts.reason?.slice(0, 160) ?? null,
        actualCostUsd: opts.actualCostUsd ?? null,
        inputTokens: opts.inputTokens ?? null,
        outputTokens: opts.outputTokens ?? null,
        cacheReadTokens: opts.cacheReadTokens ?? null,
        cacheWriteTokens: opts.cacheWriteTokens ?? null,
      },
    });
  } catch {
    // Silent — never fail the swap response over logging.
  }
}

// ─── Per-user history (for the "Your recent generations" UI) ────────

export interface MyHistoryEntry {
  id: string;
  createdAt: string;
  sourceTitle: string;
  generatedTitle: string | null;
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  category: string | null;
  costUsd: number;
  sizes: string[];
  variants: string[];
  listing: SavedListing | null;
}

export interface MyHistoryResponse {
  /** Human label for the active window e.g. "November 2026" or "All time" */
  windowLabel: string;
  /** UTC instant when this window started (PKT month start, or null for all-time) */
  windowStartIso: string | null;
  /** UTC instant when this window will end (next PKT month start, or null) */
  windowEndIso: string | null;
  entries: MyHistoryEntry[];
}

/**
 * Per-row mapper — keep DB → API shape in one place.
 */
function toMyHistoryEntry(r: {
  id: string;
  createdAt: Date;
  sourceTitle: string;
  generatedTitle: string | null;
  verdict: string;
  category: string | null;
  actualCostUsd: number | null;
  sizes: string[];
  variants: string[];
  listingJson: unknown;
}): MyHistoryEntry {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    sourceTitle: r.sourceTitle,
    generatedTitle: r.generatedTitle,
    verdict: (r.verdict === "REVIEW"
      ? "REVIEW"
      : r.verdict === "BLOCKED"
        ? "BLOCKED"
        : "ALLOWED") as MyHistoryEntry["verdict"],
    category: r.category,
    costUsd:
      typeof r.actualCostUsd === "number" && r.actualCostUsd > 0
        ? r.actualCostUsd
        : estimateGenerationCostUsd(r.verdict),
    sizes: r.sizes ?? [],
    variants: r.variants ?? [],
    listing: (r.listingJson as SavedListing | null) ?? null,
  };
}

/**
 * Pull a user's own generations.
 *
 * - `scope: "month"` (default) → current PKT calendar month, newest
 *   first. Used by the inline history section on /seo-autopilot.
 * - `scope: "all"` → every generation the user has ever made (capped
 *   at `limit`). Used by the dedicated /seo-autopilot/listings page.
 *
 * Either way the listing is filtered by `userId`, so an employee only
 * ever sees their own rows.
 */
export async function getMyHistory(
  userId: string,
  opts: { limit?: number; scope?: "month" | "all" } = {},
): Promise<MyHistoryResponse> {
  const limit = opts.limit ?? 200;
  const scope = opts.scope ?? "month";

  const monthStart = pktCurrentMonthStartUtc();
  const monthEnd = nextPktMonthStartUtc();

  const where =
    scope === "month"
      ? { userId, createdAt: { gte: monthStart } }
      : { userId };

  const rows = await prisma.seoAutopilotLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return {
    windowLabel:
      scope === "month" ? pktCurrentMonthLabel() : "All time",
    windowStartIso: scope === "month" ? monthStart.toISOString() : null,
    windowEndIso: scope === "month" ? monthEnd.toISOString() : null,
    entries: rows.map(toMyHistoryEntry),
  };
}

/**
 * Fetch one historical generation by ID, scoped to the requesting user
 * (returns null if it belongs to someone else). Used by the "Restore"
 * action — `/seo-autopilot?restore=<id>` calls this to populate the
 * result panel without firing a fresh API call.
 */
export async function getMyHistoryEntry(
  userId: string,
  id: string,
): Promise<MyHistoryEntry | null> {
  const row = await prisma.seoAutopilotLog.findFirst({
    where: { id, userId },
  });
  if (!row) return null;
  return toMyHistoryEntry(row);
}
