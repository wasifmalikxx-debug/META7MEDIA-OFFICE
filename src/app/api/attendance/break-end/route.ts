import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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

  // Check if late from break → auto-fine
  const settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
  });
  if (settings && settings.breakLateFineAmt > 0) {
    const [breakEndHour, breakEndMin] = settings.breakEndTime.split(":").map(Number);
    const scheduledBreakEnd = new Date(today);
    scheduledBreakEnd.setHours(breakEndHour, breakEndMin + (settings.breakGraceMinutes || 0), 0, 0);

    if (now > scheduledBreakEnd) {
      const lateMinutes = Math.floor((now.getTime() - scheduledBreakEnd.getTime()) / (1000 * 60));
      const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
      if (admin) {
        await prisma.fine.create({
          data: {
            userId: session.user.id,
            type: "POLICY_VIOLATION",
            amount: settings.breakLateFineAmt,
            reason: `Late from break by ${lateMinutes} min`,
            date: today,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            issuedById: admin.id,
          },
        });

        // WhatsApp: notify employee about break late fine (fire-and-forget)
        try {
          const { notifyEmployee, breakFineMsg } = await import("@/lib/services/whatsapp.service");
          const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true } });
          const empName = user ? `${user.firstName} ${user.lastName || ""}`.trim() : "Employee";
          notifyEmployee(session.user.id, breakFineMsg(empName, lateMinutes, settings.breakLateFineAmt)).catch(() => {});
        } catch {}
      }
    }
  }

  return json(updated);
}
