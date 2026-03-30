import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma, getCachedSettings } from "@/lib/prisma";
import { todayPKT, nowPKT, pktMinutesSinceMidnight, pktMonth, pktYear } from "@/lib/pkt";

export async function POST() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const now = nowPKT();
    const today = todayPKT();

    const attendance = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session.user.id, date: today } },
    });

    if (!attendance || !attendance.breakStart) {
      return error("No active break to end");
    }
    if (attendance.breakEnd) {
      return error("Break already ended");
    }

    const breakMinutes = Math.floor(
      (now.getTime() - attendance.breakStart.getTime()) / (1000 * 60)
    );

    // Minimum 15 minutes break required
    if (breakMinutes < 15) {
      return error(`Break must be at least 15 minutes. You've been on break for ${breakMinutes} min.`);
    }

    const updated = await prisma.attendance.update({
      where: { id: attendance.id },
      data: { breakEnd: now, breakMinutes },
    });

    // Check if late from break → auto-fine (using PKT time)
    const settings = await getCachedSettings();
    if (settings && settings.breakLateFineAmt > 0) {
      const [breakEndHour, breakEndMin] = (settings.breakEndTime || "16:00").split(":").map(Number);
      // Compare in PKT minutes
      const currentPKTMin = pktMinutesSinceMidnight();
      const scheduledEndMin = breakEndHour * 60 + breakEndMin + (settings.breakGraceMinutes || 0);

      if (currentPKTMin > scheduledEndMin) {
        const lateMinutes = currentPKTMin - scheduledEndMin;
        const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
        if (admin) {
          await prisma.fine.create({
            data: {
              userId: session.user.id,
              type: "POLICY_VIOLATION",
              amount: settings.breakLateFineAmt,
              reason: `Late from break by ${lateMinutes} min`,
              date: today,
              month: pktMonth(),
              year: pktYear(),
              issuedById: admin.id,
            },
          });

          // WhatsApp: notify employee about break late fine via template
          try {
            const { sendBreakFineTemplate } = await import("@/lib/services/whatsapp.service");
            const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true, phone: true } });
            const empName = user ? `${user.firstName} ${user.lastName || ""}`.trim() : "Employee";
            if (user?.phone) {
              sendBreakFineTemplate(user.phone, empName, lateMinutes, settings.breakLateFineAmt).catch((e) => console.error(`[WHATSAPP] Break fine to ${user.phone} failed:`, e.message));
            }
          } catch {}
        }
      }
    }

    return json(updated);
  } catch (err: any) {
    return error(err.message || "Failed to end break", 500);
  }
}
