import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma, getCachedSettings } from "@/lib/prisma";
import { todayPKT, pktMonth, pktYear, pktMinutesSinceMidnight } from "@/lib/pkt";
import { createNotification } from "@/lib/services/notification.service";
import { resolveAttendanceStatus } from "@/lib/services/attendance-status";
import { maybeCreateBreakSkipFine } from "@/lib/services/break-fine";

// GET /api/attendance/auto-checkout — called by Vercel cron only
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && process.env.NODE_ENV === "production") {
    return error("Unauthorized", 401);
  }
  // SAFETY: Even via cron, only run if it's actually late in the day (after work end time)
  // This prevents accidental early checkouts if cron fires at the wrong time
  const settings = await getCachedSettings();
  const [weH, weM] = (settings?.workEndTime || "19:00").split(":").map(Number);
  const workEndMin = weH * 60 + weM;
  const currentMin = pktMinutesSinceMidnight();
  if (currentMin < workEndMin) {
    return error(`Auto-checkout can only run after ${settings?.workEndTime || "19:00"} PKT. Current PKT time: ${Math.floor(currentMin/60)}:${String(currentMin%60).padStart(2,"0")}`, 400);
  }
  return handleAutoCheckout();
}

// POST /api/attendance/auto-checkout — SUPER_ADMIN only (manual trigger)
export async function POST() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") return error("Forbidden — CEO only", 403);
  // Also enforce time window for manual POST — no accidental early runs
  const settings = await getCachedSettings();
  const [weH, weM] = (settings?.workEndTime || "19:00").split(":").map(Number);
  const workEndMin = weH * 60 + weM;
  const currentMin = pktMinutesSinceMidnight();
  if (currentMin < workEndMin) {
    return error(`Auto-checkout can only run after ${settings?.workEndTime || "19:00"} PKT.`, 400);
  }
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

      // Resolve status using single source of truth
      const resolved = await resolveAttendanceStatus({
        userId: att.user.id,
        date: today,
        workedMinutes,
        lateMinutes: att.lateMinutes,
        currentStatus: att.status,
      });
      const status = resolved.status;

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

      const hasFirstHalf = resolved.halfDayPeriod === "FIRST_HALF";
      const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
      const month = pktMonth();
      const year = pktYear();

      // Fine: No daily report submitted (skip if first-half leave — arrived late, less time)
      if (!hasFirstHalf) {
        const dailyReport = await prisma.dailyReport.findUnique({
          where: { userId_date: { userId: att.user.id, date: today } },
        });
        const existingReportFine = await prisma.fine.findFirst({
          where: { userId: att.user.id, date: today, reason: "Daily report not submitted before auto-checkout" },
        });
        if (!dailyReport && !existingReportFine && settings?.noReportFineAmt > 0 && admin) {
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
      }

      // Break skip fine — use single source of truth
      if (admin) {
        await maybeCreateBreakSkipFine({
          userId: att.user.id,
          date: today,
          breakStart: att.breakStart,
          checkIn: att.checkIn,
          checkOut: checkoutTime,
          workedMinutes,
          adminId: admin.id,
        });
      }

      results.push({ name, workedMinutes, status, autoCheckout: true });
    }

    return json({ mode: "checkout", count: results.length, results });
  } catch (err: any) {
    return error(err.message);
  }
}
