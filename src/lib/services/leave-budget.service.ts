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

  const systemStart = new Date(Date.UTC(SYSTEM_START_YEAR, SYSTEM_START_MONTH, 1));

  // Count covered absences from fines (amount=0, "Covered by paid leave")
  const coveredAbsenceFines = await prisma.fine.count({
    where: {
      userId,
      amount: 0,
      reason: { contains: "Covered by paid leave" },
      date: { gte: systemStart },
    },
  });

  // Also count ABSENT attendance records that have NO fine at all
  // (cron may not have created a fine if salary structure was missing at the time)
  const absentDates = await prisma.attendance.findMany({
    where: {
      userId,
      status: "ABSENT",
      date: { gte: systemStart },
    },
    select: { date: true },
  });
  // Check which absences have no fine record
  let uncoveredAbsencesWithoutFine = 0;
  for (const att of absentDates) {
    const hasFine = await prisma.fine.findFirst({
      where: { userId, date: att.date, type: "ABSENT_WITHOUT_LEAVE" },
    });
    if (!hasFine) {
      uncoveredAbsencesWithoutFine++;
    }
  }

  // Count ONLY half-day leave requests (not wrongly-marked HALF_DAY attendance)
  const halfDayLeaves = await prisma.leaveRequest.count({
    where: {
      userId,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: systemStart },
    },
  });

  // Each covered absence = 1.0 used, each orphan absence = 1.0 used, each half-day = 0.5 used
  const totalUsed = coveredAbsenceFines + uncoveredAbsencesWithoutFine + (halfDayLeaves * 0.5);
  const available = Math.max(0, totalEarned - totalUsed);

  return { totalEarned, totalUsed, available };
}
