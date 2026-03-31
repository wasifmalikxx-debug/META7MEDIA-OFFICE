import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma, getCachedSettings } from "@/lib/prisma";
import { todayPKT, pktMonth, pktYear } from "@/lib/pkt";
import { createNotification } from "@/lib/services/notification.service";

// GET /api/attendance/auto-checkout — called by Vercel cron
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && process.env.NODE_ENV === "production") {
    return error("Unauthorized", 401);
  }
  return handleAutoCheckout();
}

// POST /api/attendance/auto-checkout — called manually by admin
export async function POST() {
  return handleAutoCheckout();
}

async function handleAutoCheckout() {
  try {
    const today = todayPKT();

    // Find employees who checked in but didn't check out
    const openAttendances = await prisma.attendance.findMany({
      where: {
        date: today,
        checkIn: { not: null },
        checkOut: null,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    });

    if (openAttendances.length === 0) {
      return json({ message: "No open attendances", count: 0 });
    }

    const settings = await getCachedSettings();
    const [endH, endM] = (settings?.workEndTime || "19:00").split(":").map(Number);
    const [startH, startM] = (settings?.workStartTime || "11:00").split(":").map(Number);
    const fullDayMinutes = (endH * 60 + endM) - (startH * 60 + startM);

    // Use actual current PKT time as checkout timestamp (not office end time)
    // This shows the real time the system checked them out (e.g. 7:30 PM)
    const checkoutTime = new Date(Date.now() + 5 * 60 * 60_000); // nowPKT()

    const results: any[] = [];

    for (const att of openAttendances) {
      const name = `${att.user.firstName} ${att.user.lastName || ""}`.trim();
      const checkIn = new Date(att.checkIn!);

      let breakMinutes = 0;
      if (att.breakStart && att.breakEnd) {
        breakMinutes = Math.floor(
          (att.breakEnd.getTime() - att.breakStart.getTime()) / (1000 * 60)
        );
      }
      const workedMinutes = Math.max(0, Math.floor(
        (checkoutTime.getTime() - checkIn.getTime()) / (1000 * 60)
      ) - breakMinutes);

      // Keep existing status — HALF_DAY is only set manually via leave request
      // Auto-checkout should NOT change status to HALF_DAY
      const status = att.status;

      // Calculate early leave and overtime
      const earlyLeaveMin = Math.max(0, fullDayMinutes - workedMinutes);
      const overtimeMinutes = Math.max(0, workedMinutes - fullDayMinutes);

      // FORCE checkout — no minimum time check, no blocking
      await prisma.attendance.update({
        where: { id: att.id },
        data: {
          checkOut: checkoutTime,
          workedMinutes,
          overtimeMinutes: overtimeMinutes > 0 ? overtimeMinutes : null,
          earlyLeaveMin: earlyLeaveMin > 0 ? earlyLeaveMin : null,
          status,
          notes: "Auto-checkout by system at office closing time",
        },
      });

      // Find admin for fine issuance
      const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
      const month = pktMonth();
      const year = pktYear();

      // Fine: No daily report submitted
      const dailyReport = await prisma.dailyReport.findUnique({
        where: { userId_date: { userId: att.user.id, date: today } },
      });
      if (!dailyReport && settings?.noReportFineAmt > 0 && admin) {
        await prisma.fine.create({
          data: {
            userId: att.user.id,
            type: "POLICY_VIOLATION",
            amount: settings.noReportFineAmt,
            reason: "Daily report not submitted before auto-checkout",
            date: today,
            month,
            year,
            issuedById: admin.id,
          },
        });
        await createNotification(
          att.user.id,
          "FINE_ISSUED",
          "Fine: Report Not Submitted",
          `PKR ${settings.noReportFineAmt} fine — daily report was not submitted. You were auto-checked out.`,
          "/fines"
        );
      }

      // Fine: Break skipped (didn't log break)
      if (!att.breakStart && settings?.breakLateFineAmt > 0 && admin) {
        await prisma.fine.create({
          data: {
            userId: att.user.id,
            type: "POLICY_VIOLATION",
            amount: settings.breakLateFineAmt,
            reason: "Break skipped — did not log break attendance",
            date: today,
            month,
            year,
            issuedById: admin.id,
          },
        });
      }

      results.push({ name, workedMinutes, status, autoCheckout: true });
    }

    return json({ mode: "checkout", count: results.length, results });
  } catch (err: any) {
    return error(err.message);
  }
}
