import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";

/**
 * Monthly cleanup cron — runs on 1st of every month
 * Keeps only last 3 months of data, deletes everything older.
 *
 * Data cleaned:
 * - Attendance records
 * - Fine records
 * - Incentive records
 * - Payroll records
 * - Leave requests
 * - Bonus eligibility records
 * - Review bonus records
 * - Notifications
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && process.env.NODE_ENV === "production") {
    return error("Unauthorized", 401);
  }

  try {
    const now = nowPKT();
    // Keep current month + 2 previous months = 3 months total
    const cutoffDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const cutoffMonth = cutoffDate.getUTCMonth() + 1;
    const cutoffYear = cutoffDate.getUTCFullYear();

    const results: Record<string, number> = {};

    // Delete old attendance records
    const att = await prisma.attendance.deleteMany({
      where: { date: { lt: cutoffDate } },
    });
    results.attendance = att.count;

    // Delete old fines (by month/year)
    const fines = await prisma.fine.deleteMany({
      where: {
        OR: [
          { year: { lt: cutoffYear } },
          { year: cutoffYear, month: { lt: cutoffMonth } },
        ],
      },
    });
    results.fines = fines.count;

    // Delete old incentives
    const incentives = await prisma.incentive.deleteMany({
      where: {
        OR: [
          { year: { lt: cutoffYear } },
          { year: cutoffYear, month: { lt: cutoffMonth } },
        ],
      },
    });
    results.incentives = incentives.count;

    // Delete old payroll records
    const payroll = await prisma.payrollRecord.deleteMany({
      where: {
        OR: [
          { year: { lt: cutoffYear } },
          { year: cutoffYear, month: { lt: cutoffMonth } },
        ],
      },
    });
    results.payroll = payroll.count;

    // Delete old leave requests
    const leaves = await prisma.leaveRequest.deleteMany({
      where: { startDate: { lt: cutoffDate } },
    });
    results.leaves = leaves.count;

    // Delete old bonus eligibility
    const bonus = await prisma.bonusEligibility.deleteMany({
      where: {
        OR: [
          { year: { lt: cutoffYear } },
          { year: cutoffYear, month: { lt: cutoffMonth } },
        ],
      },
    });
    results.bonusEligibility = bonus.count;

    // Delete old review bonuses
    const reviews = await prisma.reviewBonus.deleteMany({
      where: {
        OR: [
          { year: { lt: cutoffYear } },
          { year: cutoffYear, month: { lt: cutoffMonth } },
        ],
      },
    });
    results.reviewBonuses = reviews.count;

    // Delete old notifications (older than 3 months)
    const notifs = await prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
    });
    results.notifications = notifs.count;

    // Delete ALL complaints (full monthly reset — user wants no long-term records)
    // Messages cascade-delete via the schema relation
    const complaints = await prisma.complaint.deleteMany({});
    results.complaints = complaints.count;

    const totalDeleted = Object.values(results).reduce((s, v) => s + v, 0);

    return json({
      message: `Cleanup complete — removed ${totalDeleted} old records`,
      keepingFrom: `${cutoffMonth}/${cutoffYear}`,
      keepingMonths: 3,
      timestamp: now.toISOString(),
      deleted: results,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
