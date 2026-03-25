import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// POST /api/attendance/auto-checkout
// Called by a cron job or manually by admin
// mode=remind → sends WhatsApp reminder to employees who haven't checked out
// mode=checkout → auto-checks out employees and notifies them
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body.mode || "checkout";

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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

    const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
    const [endH, endM] = (settings?.workEndTime || "19:00").split(":").map(Number);
    const officeEndTime = new Date(today);
    officeEndTime.setHours(endH, endM, 0, 0);

    const results: any[] = [];

    if (mode === "remind") {
      // Reminder mode — no WhatsApp for non-critical notifications
      for (const att of openAttendances) {
        const name = `${att.user.firstName} ${att.user.lastName || ""}`.trim();
        results.push({ name, reminded: false, reason: "WhatsApp reminders disabled" });
      }
      return json({ mode: "remind", count: results.length, results });
    }

    // Auto-checkout mode
    for (const att of openAttendances) {
      const name = `${att.user.firstName} ${att.user.lastName || ""}`.trim();
      const checkIn = new Date(att.checkIn!);

      // Calculate worked minutes up to office end time (not current time)
      let checkoutTime = officeEndTime;
      if (now < officeEndTime) checkoutTime = now;

      let breakMinutes = 0;
      if (att.breakStart && att.breakEnd) {
        breakMinutes = Math.floor(
          (att.breakEnd.getTime() - att.breakStart.getTime()) / (1000 * 60)
        );
      }
      const workedMinutes = Math.floor(
        (checkoutTime.getTime() - checkIn.getTime()) / (1000 * 60)
      ) - breakMinutes;

      await prisma.attendance.update({
        where: { id: att.id },
        data: {
          checkOut: checkoutTime,
          workedMinutes: Math.max(0, workedMinutes),
          notes: "Auto-checkout: employee forgot to check out",
        },
      });

      results.push({ name, workedMinutes, autoCheckout: true });
    }

    return json({ mode: "checkout", count: results.length, results });
  } catch (err: any) {
    return error(err.message);
  }
}
