import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma, getCachedSettings } from "@/lib/prisma";

export async function POST() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const now = new Date();
    // Use PKT (UTC+5) for date calculation
    const pktMs = now.getTime() + 5 * 60 * 60_000;
    const pktDate = new Date(pktMs);
    const today = new Date(Date.UTC(pktDate.getUTCFullYear(), pktDate.getUTCMonth(), pktDate.getUTCDate()));

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

    // Enforce break window using PKT time
    const settings = await getCachedSettings();
    if (settings) {
      const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
      const currentMin = (utcMin + 300) % 1440;
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
  } catch (err: any) {
    return error(err.message || "Failed to start break", 500);
  }
}
