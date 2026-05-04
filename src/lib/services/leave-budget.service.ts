import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";

/**
 * Monthly leave entitlement shown to the employee on their dashboard.
 *
 * RULE (set by Wasif on 2026-05-04):
 *   - Each month, every employee gets `paidLeavesPerMonth` of leave (default 1.0).
 *   - **No rollover.** At the start of a new month, balance resets to the full
 *     monthly entitlement regardless of last month's usage.
 *   - Only explicit half-day leave applications consume the displayed budget
 *     (each half-day = 0.5). Auto-paid absences use a separate per-month
 *     allowance — see hasMonthlyAbsenceCoverageBeenUsed() below.
 *
 * Examples (1.0/month, viewed any time in May):
 *   - Izaan: 0 May half-days → 1.0 available (April history irrelevant)
 *   - Talha: 0 May half-days → 1.0 available
 *   - Anyone who takes a half-day on May 10 → 0.5 available afterward
 */
export async function getAccumulatedLeaveBudget(
  userId: string,
  paidLeavesPerMonth: number = 1.0
): Promise<{ totalEarned: number; totalUsed: number; available: number }> {
  const now = nowPKT();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed

  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)); // last day of month

  const halfDayLeavesThisMonth = await prisma.leaveRequest.count({
    where: {
      userId,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: monthStart, lte: monthEnd },
    },
  });

  const totalEarned = paidLeavesPerMonth;
  const totalUsed = halfDayLeavesThisMonth * 0.5;
  const available = Math.max(0, totalEarned - totalUsed);

  return { totalEarned, totalUsed, available };
}

/**
 * Per-month auto-paid-absence allowance check.
 *
 * Office policy: if an employee is absent without prior leave, the FIRST
 * such absence each month is covered (no salary deduction); subsequent
 * absences in the same month are deducted at salary/30.
 *
 * Independent of the half-day-leave entitlement above — using the
 * monthly auto-cover does NOT subtract from the dashboard leave balance,
 * and using a half-day leave does NOT consume the auto-cover allowance.
 *
 * Returns true if the user has already had a covered absence this month
 * (i.e. allowance is used), false if it's still available.
 */
export async function hasMonthlyAbsenceCoverageBeenUsed(
  userId: string,
  month: number,
  year: number,
  excludeDate?: Date
): Promise<boolean> {
  const where: any = {
    userId,
    type: "ABSENT_WITHOUT_LEAVE",
    month,
    year,
    reason: { contains: "Covered by paid leave" },
  };
  if (excludeDate) {
    where.date = { not: excludeDate };
  }
  const count = await prisma.fine.count({ where });
  return count > 0;
}
