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

  if (!attendance || !attendance.checkIn) {
    return error("You must check in before starting a break");
  }
  if (attendance.breakStart) {
    return error("Break already started");
  }
  if (attendance.checkOut) {
    return error("Already checked out for the day");
  }

  const updated = await prisma.attendance.update({
    where: { id: attendance.id },
    data: { breakStart: now },
  });

  return json(updated);
}
