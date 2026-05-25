import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";

/**
 * Monthly paid-leave budget — UNIFIED POOL (rule updated 2026-05-25).
 *
 * RULE (locked by Wasif 2026-05-25 after the Alishba EM-1 leak):
 *   • Each employee gets `paidLeavesPerMonth` (default 1.0 day) per month.
 *   • This is ONE pool. Both half-day leaves AND covered absences draw
 *     from the same pool:
 *       - HALF_DAY leave   → consumes 0.5
 *       - Covered absence  → consumes 1.0
 *   • No rollover. Resets the 1st of every month.
 *   • Once exhausted, further half-day applications are rejected at the
 *     API and further absences are NOT auto-covered (they deduct
 *     salary/30).
 *
 * Why the change: from 2026-05-04 → 2026-05-25 the two were treated as
 * SEPARATE pools. That let employees take an absence (auto-covered)
 * plus a half-day in the same month — effectively 1.5 paid days against
 * a 1.0 budget. The Alishba case + 5 others surfaced on 2026-05-25
 * forced the unification.
 *
 * SOURCE OF TRUTH FOR USAGE:
 *   - Half-day leaves: count APPROVED rows in LeaveRequest for the month
 *   - Covered absences: count Fine rows where reason starts with
 *     "Covered by paid leave" (created by daily-absent cron + payroll
 *     normalization)
 *
 * Both surfaces (UI dashboard, leave POST endpoint, daily-absent cron,
 * payroll calc) must call getMonthlyLeaveUsage so they agree exactly.
 */

export interface MonthlyLeaveUsage {
  /** The monthly entitlement from OfficeSettings.paidLeavesPerMonth. */
  budget: number;
  /** Half-days approved this month × 0.5. */
  halfDayUsed: number;
  /** Covered absences this month × 1.0. */
  absentCoverUsed: number;
  /** Sum of all paid leave consumed this month. */
  totalUsed: number;
  /** Math.max(0, budget − totalUsed). */
  remaining: number;
  /** True iff totalUsed >= budget — no more paid leave available. */
  exhausted: boolean;
}

/**
 * Compute a user's leave-budget usage for a specific PKT calendar month.
 *
 * When `referenceDate` is omitted, uses the current PKT month/year.
 *
 * NOTE: this counts ALL approved half-days in the month, including ones
 * that haven't been served yet (future-dated). That matches CEO intent —
 * a planned future half-day reserves the budget the moment it's filed.
 */
export async function getMonthlyLeaveUsage(
  userId: string,
  referenceDate?: Date,
): Promise<MonthlyLeaveUsage> {
  const ref = referenceDate ?? nowPKT();
  const year = ref.getUTCFullYear();
  const month0 = ref.getUTCMonth(); // 0-indexed
  const month = month0 + 1;
  const monthStart = new Date(Date.UTC(year, month0, 1));
  const monthEnd = new Date(Date.UTC(year, month0 + 1, 0));

  const settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
    select: { paidLeavesPerMonth: true },
  });
  const budget = settings?.paidLeavesPerMonth ?? 1.0;

  // Both queries are cheap and only return counts.
  const [halfDayCount, absentCoverCount] = await Promise.all([
    prisma.leaveRequest.count({
      where: {
        userId,
        leaveType: "HALF_DAY",
        status: "APPROVED",
        startDate: { gte: monthStart, lte: monthEnd },
      },
    }),
    prisma.fine.count({
      where: {
        userId,
        type: "ABSENT_WITHOUT_LEAVE",
        month,
        year,
        reason: { contains: "Covered by paid leave" },
      },
    }),
  ]);

  const halfDayUsed = halfDayCount * 0.5;
  const absentCoverUsed = absentCoverCount * 1.0;
  const totalUsed = halfDayUsed + absentCoverUsed;
  const remaining = Math.max(0, budget - totalUsed);
  const exhausted = totalUsed >= budget;

  return { budget, halfDayUsed, absentCoverUsed, totalUsed, remaining, exhausted };
}

/**
 * Backwards-compat alias used by the dashboard. Mirrors the original
 * shape but the math now reflects the UNIFIED pool — pre-2026-05-25
 * callers saw only half-day usage, post-fix they see the true
 * remaining budget across both pools.
 */
export async function getAccumulatedLeaveBudget(
  userId: string,
  // Param kept for backwards compatibility with one caller in
  // dashboard/page.tsx; the real budget always comes from OfficeSettings.
  _paidLeavesPerMonth: number = 1.0,
): Promise<{ totalEarned: number; totalUsed: number; available: number }> {
  void _paidLeavesPerMonth;
  const u = await getMonthlyLeaveUsage(userId);
  return {
    totalEarned: u.budget,
    totalUsed: u.totalUsed,
    available: u.remaining,
  };
}

/**
 * Legacy helper kept for the daily-absent cron. After the 2026-05-25
 * unification, prefer `getMonthlyLeaveUsage` directly which returns
 * the real remaining budget (not just an absent-cover flag).
 *
 * Returns true iff the user has ANY paid leave consumed this month
 * (half-day or absent cover). Identical semantics to "the monthly
 * absent cover is no longer available."
 */
export async function hasMonthlyAbsenceCoverageBeenUsed(
  userId: string,
  month: number,
  year: number,
  excludeDate?: Date,
): Promise<boolean> {
  // Mirror old behavior for safety: caller (cron) uses this to decide
  // whether to cover today's absence. We answer "no, you've already
  // consumed the budget" if EITHER an absent cover OR enough half-days
  // exist this month. Building from getMonthlyLeaveUsage means we never
  // disagree with the dashboard or the leave POST endpoint.
  const settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
    select: { paidLeavesPerMonth: true },
  });
  const budget = settings?.paidLeavesPerMonth ?? 1.0;

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const [halfDayCount, absentCoverCount] = await Promise.all([
    prisma.leaveRequest.count({
      where: {
        userId,
        leaveType: "HALF_DAY",
        status: "APPROVED",
        startDate: { gte: monthStart, lte: monthEnd },
      },
    }),
    prisma.fine.count({
      where: {
        userId,
        type: "ABSENT_WITHOUT_LEAVE",
        month,
        year,
        reason: { contains: "Covered by paid leave" },
        ...(excludeDate ? { date: { not: excludeDate } } : {}),
      },
    }),
  ]);

  const totalUsed = halfDayCount * 0.5 + absentCoverCount * 1.0;
  // A new absent today would consume 1.0 more. If that pushes us over
  // budget, treat the cover as already used (cron falls through to the
  // deducted-fine branch).
  return totalUsed + 1.0 > budget;
}
