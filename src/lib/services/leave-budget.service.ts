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

  // Parse all absence fines. The fine reason encodes how many budget days were
  // consumed (set by payroll.service.ts normalization and daily-absent cron):
  //   - "Covered by paid leave (1.0 day used)" / "Covered by paid leave" → 1.0
  //   - "Partially covered by paid leave (X day used)"                   → X
  //   - Anything else (uncovered full fine)                              → 0
  const absentFines = await prisma.fine.findMany({
    where: {
      userId,
      type: "ABSENT_WITHOUT_LEAVE",
      date: { gte: systemStart },
    },
    select: { reason: true, date: true },
  });
  const datesWithFine = new Set(absentFines.map((f) => f.date.toISOString()));
  let absentDaysUsed = 0;
  for (const f of absentFines) {
    const r = f.reason || "";
    const partial = r.match(/Partially covered by paid leave \((\d+(?:\.\d+)?) day used\)/i);
    if (partial) {
      absentDaysUsed += parseFloat(partial[1]);
    } else if (/Covered by paid leave/i.test(r)) {
      absentDaysUsed += 1;
    }
    // else: uncovered — consumes 0 budget days
  }

  // Orphan absents: ABSENT attendance with NO fine at all. Treat as 1 day
  // fully used so the budget can't be re-spent later on the same day.
  const absentDates = await prisma.attendance.findMany({
    where: { userId, status: "ABSENT", date: { gte: systemStart } },
    select: { date: true },
  });
  let uncoveredAbsencesWithoutFine = 0;
  for (const att of absentDates) {
    if (!datesWithFine.has(att.date.toISOString())) uncoveredAbsencesWithoutFine++;
  }

  // Half-day leave requests — each consumes 0.5 day.
  const halfDayLeaves = await prisma.leaveRequest.count({
    where: {
      userId,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: systemStart },
    },
  });

  const totalUsed = absentDaysUsed + uncoveredAbsencesWithoutFine + halfDayLeaves * 0.5;
  const available = Math.max(0, totalEarned - totalUsed);

  return { totalEarned, totalUsed, available };
}
