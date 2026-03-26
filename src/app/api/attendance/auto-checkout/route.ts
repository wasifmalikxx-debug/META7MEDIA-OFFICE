import { json, error } from "@/lib/api-helpers";
import { prisma, getCachedSettings } from "@/lib/prisma";
import { todayPKT } from "@/lib/pkt";

// GET /api/attendance/auto-checkout — called by Vercel cron
export async function GET() {
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

    // Force checkout time = office end time in UTC
    // Office end 19:00 PKT = 14:00 UTC
    const checkoutTime = new Date(today.getTime() + (endH * 60 + endM) * 60_000 - 5 * 60 * 60_000);

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

      // Determine status based on worked time
      let status = att.status;
      if (workedMinutes < fullDayMinutes * 0.75) {
        status = "HALF_DAY";
      }

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

      results.push({ name, workedMinutes, status, autoCheckout: true });
    }

    return json({ mode: "checkout", count: results.length, results });
  } catch (err: any) {
    return error(err.message);
  }
}
