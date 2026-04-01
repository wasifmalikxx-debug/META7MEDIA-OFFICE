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
  // Get employee's first attendance record (when they started using the system)
  const firstAttendance = await prisma.attendance.findFirst({
    where: { userId },
    orderBy: { date: "asc" },
    select: { date: true },
  });

  if (!firstAttendance) {
    // No attendance records yet — give them 1 month budget
    return { totalEarned: paidLeavesPerMonth, totalUsed: 0, available: paidLeavesPerMonth };
  }

  // Calculate months from first attendance to current month
  const now = nowPKT();
  const startDate = new Date(firstAttendance.date);
  const startYear = startDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  const monthsActive = Math.max(1, (currentYear - startYear) * 12 + (currentMonth - startMonth) + 1);
  const totalEarned = monthsActive * paidLeavesPerMonth;

  // Count all covered leaves across all time (fines with amount=0 and "Covered by paid leave" in reason)
  const coveredAbsences = await prisma.fine.count({
    where: {
      userId,
      amount: 0,
      reason: { contains: "Covered by paid leave" },
    },
  });

  // Count ONLY half-day leave requests (not wrongly-marked HALF_DAY attendance)
  // Only approved half-day leave requests actually consume budget
  const halfDayLeaves = await prisma.leaveRequest.count({
    where: {
      userId,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: startDate },
    },
  });

  // Each covered absence = 1.0 used, each half-day leave = 0.5 used
  const totalUsed = coveredAbsences + (halfDayLeaves * 0.5);
  const available = Math.max(0, totalEarned - totalUsed);

  return { totalEarned, totalUsed, available };
}
