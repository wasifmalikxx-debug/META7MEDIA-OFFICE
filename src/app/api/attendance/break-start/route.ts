import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { todayPKT, nowPKT } from "@/lib/pkt";

/**
 * Break-start endpoint — PERMISSIVE by design.
 *
 * No PKT time window check. Employee can start their break whenever.
 * The server just records the actual PKT moment. Wrong timing is handled
 * by the late-break fine at break-end (calculated from scheduled break end).
 *
 * This removes timezone-related blocking issues for remote employees.
 */
export async function POST() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const now = nowPKT();
    const today = todayPKT();

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
  } catch (err: any) {
    return error(err.message || "Failed to start break", 500);
  }
}
