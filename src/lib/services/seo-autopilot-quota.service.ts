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

export const SEO_AUTOPILOT_DAILY_LIMIT = 8;

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

export interface TeamStatsResponse {
  today: string; // PKT YYYY-MM-DD
  limit: number;
  totalToday: number;
  totalYesterday: number;
  total7Day: number;
  // Estimated USD spend across all users in each window
  costTodayUsd: number;
  costYesterdayUsd: number;
  cost7DayUsd: number;
  entries: TeamUsageEntry[];
  recent: RecentGeneration[]; // newest first, capped at 50
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

  // Run usage + log queries in parallel.
  const [usageRows, logRows] = await Promise.all([
    prisma.seoAutopilotUsage.findMany({
      where: { date: { gte: sevenDaysAgo } },
      include: {
        user: {
          select: {
            id: true,
            employeeId: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    }),
    prisma.seoAutopilotLog.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            employeeId: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
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
      countToday: number;
      countYesterday: number;
      count7Day: number;
      allowedCount: number;
      reviewCount: number;
      blockedCount: number;
      lastGeneratedAt: Date | null;
      cost7DayUsd: number;
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
        countToday: 0,
        countYesterday: 0,
        count7Day: 0,
        allowedCount: 0,
        reviewCount: 0,
        blockedCount: 0,
        lastGeneratedAt: null,
        cost7DayUsd: 0,
      };
    const t = r.date.getTime();
    if (t === todayTime) entry.countToday += r.count;
    if (t === yesterdayTime) entry.countYesterday += r.count;
    entry.count7Day += r.count;
    byUser.set(key, entry);
  }

  // ─── Layer in log-derived verdict breakdown + cost + last-gen ───
  // Track per-day total cost across all users (today / yesterday / 7d)
  // by iterating logRows once — cheaper than another aggregate query.
  let costTodayUsd = 0;
  let costYesterdayUsd = 0;
  let cost7DayUsd = 0;

  for (const log of logRows) {
    if (!log.user) continue;
    const logCost = estimateGenerationCostUsd(log.verdict);
    // Anchor the log to a PKT calendar day (UTC midnight of that day).
    const logDayUtcMidnight = pktDateAsUtcMidnight(log.createdAt);
    const logDayTime = logDayUtcMidnight.getTime();
    cost7DayUsd += logCost;
    if (logDayTime === todayTime) costTodayUsd += logCost;
    if (logDayTime === yesterdayTime) costYesterdayUsd += logCost;

    const entry = byUser.get(log.userId);
    if (!entry) {
      // User has a log row but no usage row — possible if usage row got
      // deleted manually. Synthesize an entry so they still show up.
      byUser.set(log.userId, {
        employeeId: log.user.employeeId,
        name: `${log.user.firstName} ${log.user.lastName}`.trim(),
        role: log.user.role,
        countToday: 0,
        countYesterday: 0,
        count7Day: 0,
        allowedCount: log.verdict === "ALLOWED" ? 1 : 0,
        reviewCount: log.verdict === "REVIEW" ? 1 : 0,
        blockedCount: log.verdict === "BLOCKED" ? 1 : 0,
        lastGeneratedAt: log.createdAt,
        cost7DayUsd: logCost,
      });
      continue;
    }
    if (log.verdict === "ALLOWED") entry.allowedCount += 1;
    else if (log.verdict === "REVIEW") entry.reviewCount += 1;
    else if (log.verdict === "BLOCKED") entry.blockedCount += 1;
    entry.cost7DayUsd += logCost;
    if (!entry.lastGeneratedAt || log.createdAt > entry.lastGeneratedAt) {
      entry.lastGeneratedAt = log.createdAt;
    }
  }

  const entries: TeamUsageEntry[] = Array.from(byUser.entries())
    .map(([userId, v]) => ({
      userId,
      employeeId: v.employeeId,
      name: v.name,
      role: v.role,
      countToday: v.countToday,
      countYesterday: v.countYesterday,
      count7Day: v.count7Day,
      allowedCount: v.allowedCount,
      reviewCount: v.reviewCount,
      blockedCount: v.blockedCount,
      lastGeneratedAt: v.lastGeneratedAt?.toISOString() ?? null,
      cost7DayUsd: v.cost7DayUsd,
      isOverLimit:
        v.role !== "SUPER_ADMIN" && v.countToday >= SEO_AUTOPILOT_DAILY_LIMIT,
    }))
    .sort(
      (a, b) =>
        b.countToday - a.countToday ||
        b.count7Day - a.count7Day ||
        a.name.localeCompare(b.name),
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
    estimatedCostUsd: estimateGenerationCostUsd(l.verdict),
  }));

  return {
    today: today.toISOString().slice(0, 10),
    limit: SEO_AUTOPILOT_DAILY_LIMIT,
    totalToday: entries.reduce((s, e) => s + e.countToday, 0),
    totalYesterday: entries.reduce((s, e) => s + e.countYesterday, 0),
    total7Day: entries.reduce((s, e) => s + e.count7Day, 0),
    costTodayUsd,
    costYesterdayUsd,
    cost7DayUsd,
    entries,
    recent,
  };
}

/**
 * Insert a per-event log row. Called by /api/seo-autopilot/generate
 * right after the slot becomes permanent (i.e. won't be refunded).
 *
 * Best-effort: any failure is swallowed — logging must never break a
 * successful generation.
 */
export async function logGeneration(opts: {
  userId: string;
  sourceTitle: string;
  generatedTitle: string | null;
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  category: string | null;
}): Promise<void> {
  try {
    await prisma.seoAutopilotLog.create({
      data: {
        userId: opts.userId,
        sourceTitle: opts.sourceTitle.slice(0, 500),
        generatedTitle: opts.generatedTitle?.slice(0, 160) ?? null,
        verdict: opts.verdict,
        category: opts.category?.slice(0, 200) ?? null,
      },
    });
  } catch {
    // Silent — never fail a generation because audit logging failed.
  }
}
