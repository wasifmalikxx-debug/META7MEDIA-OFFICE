import { NextRequest } from "next/server";
import { json, error, serverError, requireCronSecret, isMaintenanceMode } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";

/**
 * Monthly cleanup cron — runs on 1st of every month
 * Keeps only last 3 months of data, deletes everything older.
 *
 * Data cleaned (3-month retention):
 * - Attendance records
 * - Fine records
 * - Incentive records
 * - Payroll records
 * - Leave requests
 * - Bonus eligibility records
 * - Review bonus records
 * - Notifications
 *
 * EXCEPTION — Complaints/requests use a 12-month rolling retention (NOT 3),
 * so the CEO can browse past requests by month. See the inline note below.
 * (This cron used to wipe ALL complaints every 1st; that destroyed open
 * requests and was removed.)
 */
export async function GET(request: NextRequest) {
  const gate = requireCronSecret(request);
  if (gate) return gate;

  // Stand down while the portal is locked.
  // Monthly data cleanup — deletes old rows. Held because a destructive job
  // should never run unattended while the portal is closed.
  if (isMaintenanceMode()) {
    return json(
    { skipped: "maintenance_mode", deleted: 0 },
    );
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

    // Complaints: KEEP a rolling 12-month history.
    // (PREVIOUSLY this did `deleteMany({})` — a full wipe every 1st — which
    // silently destroyed the CEO's still-open employee requests each month.
    // The CEO now browses requests by month, so we retain a year and prune
    // only threads older than that by creation date. Messages cascade-delete.)
    const complaintCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
    const complaints = await prisma.complaint.deleteMany({
      where: { createdAt: { lt: complaintCutoff } },
    });
    results.complaints = complaints.count;

    const totalDeleted = Object.values(results).reduce((s, v) => s + v, 0);

    return json({
      message: `Cleanup complete — removed ${totalDeleted} old records`,
      keepingFrom: `${cutoffMonth}/${cutoffYear}`,
      keepingMonths: 3,
      complaintsKeepingMonths: 12,
      complaintsKeepingFrom: `${complaintCutoff.getUTCMonth() + 1}/${complaintCutoff.getUTCFullYear()}`,
      timestamp: now.toISOString(),
      deleted: results,
    });
  } catch (err: any) {
    return serverError(err, "Something went wrong. Please try again.", 500);
  }
}
