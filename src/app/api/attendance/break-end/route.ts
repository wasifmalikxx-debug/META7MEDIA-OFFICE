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

  const updated = await prisma.attendance.update({
    where: { id: attendance.id },
    data: { breakEnd: now, breakMinutes },
  });

  return json(updated);
}
