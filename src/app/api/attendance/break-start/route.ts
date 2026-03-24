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

  // Enforce break window
  const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
  if (settings) {
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const [bsH, bsM] = settings.breakStartTime.split(":").map(Number);
    const [beH, beM] = settings.breakEndTime.split(":").map(Number);
    if (currentMin < bsH * 60 + bsM || currentMin > beH * 60 + beM) {
      return error(`Break can only be started between ${settings.breakStartTime} and ${settings.breakEndTime}`);
    }
  }

  const updated = await prisma.attendance.update({
    where: { id: attendance.id },
    data: { breakStart: now },
  });

  return json(updated);
}
