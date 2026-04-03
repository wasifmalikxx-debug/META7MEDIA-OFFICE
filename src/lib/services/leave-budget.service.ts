import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";

/**
 * Calculate accumulated paid leave budget for an employee.
 * Unused leaves roll over to future months.
 *
 * totalEarned = months employed × paidLeavesPerMonth
 * totalUsed = all covered absences (fine amount=0) + covered half-days (0.5 each)
 * available = totalEarned - totalUsed
 */
export async function getAccumulatedLeaveBudget(
  userId: string,
  paidLeavesPerMonth: number = 1.0
): Promise<{ totalEarned: number; totalUsed: number; available: number }> {
  // System start date: April 2026 (leave tracking begins from this month)
  const SYSTEM_START_YEAR = 2026;
  const SYSTEM_START_MONTH = 3; // 0-indexed: 3 = April

  const now = nowPKT();
  const startYear = SYSTEM_START_YEAR;
  const startMonth = SYSTEM_START_MONTH;
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  const monthsActive = Math.max(1, (currentYear - startYear) * 12 + (currentMonth - startMonth) + 1);
  const totalEarned = monthsActive * paidLeavesPerMonth;

  // Count covered leaves from system start date onwards only
  const coveredAbsences = await prisma.fine.count({
    where: {
      userId,
      amount: 0,
      reason: { contains: "Covered by paid leave" },
      date: { gte: new Date(Date.UTC(SYSTEM_START_YEAR, SYSTEM_START_MONTH, 1)) },
    },
  });

  // Count ONLY half-day leave requests (not wrongly-marked HALF_DAY attendance)
  // Only approved half-day leave requests actually consume budget
  const halfDayLeaves = await prisma.leaveRequest.count({
    where: {
      userId,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: new Date(Date.UTC(SYSTEM_START_YEAR, SYSTEM_START_MONTH, 1)) },
    },
  });

  // Each covered absence = 1.0 used, each half-day leave = 0.5 used
  const totalUsed = coveredAbsences + (halfDayLeaves * 0.5);
  const available = Math.max(0, totalEarned - totalUsed);

  return { totalEarned, totalUsed, available };
}
