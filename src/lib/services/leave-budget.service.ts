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
  // Get employee joining date
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { joiningDate: true },
  });

  if (!user?.joiningDate) {
    return { totalEarned: paidLeavesPerMonth, totalUsed: 0, available: paidLeavesPerMonth };
  }

  // Calculate months from joining to current month
  const now = nowPKT();
  const joinDate = new Date(user.joiningDate);
  const joinYear = joinDate.getUTCFullYear();
  const joinMonth = joinDate.getUTCMonth();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  const monthsEmployed = Math.max(1, (currentYear - joinYear) * 12 + (currentMonth - joinMonth) + 1);
  const totalEarned = monthsEmployed * paidLeavesPerMonth;

  // Count all covered leaves across all time (fines with amount=0 and "Covered by paid leave" in reason)
  const coveredAbsences = await prisma.fine.count({
    where: {
      userId,
      amount: 0,
      reason: { contains: "Covered by paid leave" },
    },
  });

  // Count attendance records marked HALF_DAY that consumed budget
  // (half-days with a corresponding covered fine are counted above, but
  // half-days from leave requests also consume 0.5 each)
  const halfDayAttendances = await prisma.attendance.count({
    where: {
      userId,
      status: "HALF_DAY",
      date: { gte: joinDate },
    },
  });

  // Each covered absence = 1.0 used, each half-day attendance = 0.5 used
  const totalUsed = coveredAbsences + (halfDayAttendances * 0.5);
  const available = Math.max(0, totalEarned - totalUsed);

  return { totalEarned, totalUsed, available };
}
