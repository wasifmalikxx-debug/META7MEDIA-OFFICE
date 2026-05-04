import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";

const SYSTEM_START_YEAR = 2026;
const SYSTEM_START_MONTH = 3; // 0-indexed: 3 = April

/**
 * Calculate accumulated paid leave budget shown to the employee.
 *
 * RULE (set by Wasif on 2026-05-04, replacing the older "absences also
 * consume budget" model):
 *
 *   - Each month an employee earns `paidLeavesPerMonth` of leave entitlement.
 *   - Unused entitlement rolls forward indefinitely.
 *   - ONLY explicit half-day leave applications (LeaveRequest with
 *     leaveType=HALF_DAY, status=APPROVED) consume 0.5 each from this pool.
 *   - Auto-paid absences (where the daily-absent cron covers the first absent
 *     of the month) do NOT consume from this pool — they have their own
 *     per-month allowance, see hasMonthlyAbsenceCoverageBeenUsed() below.
 *
 * Examples (all assume 1 leave/month, system started April 2026):
 *   - Izaan: no leaves taken → in May has 2.0 (April + May, both unused)
 *   - Talha: 1 half-day in April → in May has 1.5 (2.0 earned − 0.5 used)
 *   - Maira: 0 half-day leaves, just absences → in May has 2.0
 *     (her covered absent uses the per-month allowance, not this pool)
 */
export async function getAccumulatedLeaveBudget(
  userId: string,
  paidLeavesPerMonth: number = 1.0
): Promise<{ totalEarned: number; totalUsed: number; available: number }> {
  const now = nowPKT();
  const monthsActive = Math.max(
    1,
    (now.getUTCFullYear() - SYSTEM_START_YEAR) * 12 +
      (now.getUTCMonth() - SYSTEM_START_MONTH) +
      1
  );
  const totalEarned = monthsActive * paidLeavesPerMonth;

  const systemStart = new Date(Date.UTC(SYSTEM_START_YEAR, SYSTEM_START_MONTH, 1));

  const halfDayLeaves = await prisma.leaveRequest.count({
    where: {
      userId,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: systemStart },
    },
  });

  const totalUsed = halfDayLeaves * 0.5;
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
 * This allowance is SEPARATE from the half-day-leave budget above —
 * it doesn't roll over, doesn't carry forward, doesn't show on the
 * employee's leave-balance dashboard. It's purely a decision input
 * for the daily-absent cron and the payroll absent-fine normalizer.
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
