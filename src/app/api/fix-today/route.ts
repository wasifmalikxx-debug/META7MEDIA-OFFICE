import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { todayPKT } from "@/lib/pkt";

// One-time fix for April 3 (Friday) — power outage during checkout
// 1. Fix all HALF_DAY back to PRESENT/LATE
// 2. Fix checkout timestamps (02:00 PM UTC → 07:30 PM PKT-shifted)
// 3. Recalculate workedMinutes
// 4. Do NOT add fines (technical issue, not employee fault)
// DELETE THIS FILE after running
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const today = todayPKT();
  const PKT_OFFSET_MS = 5 * 60 * 60_000;

  const records = await prisma.attendance.findMany({
    where: { date: today },
    select: {
      id: true, userId: true, status: true, checkIn: true, checkOut: true,
      breakStart: true, breakEnd: true, lateMinutes: true, workedMinutes: true,
    },
  });

  let fixed = 0;

  for (const rec of records) {
    const updates: any = {};

    // Fix HALF_DAY → PRESENT or LATE
    if (rec.status === "HALF_DAY") {
      updates.status = rec.lateMinutes && rec.lateMinutes > 0 ? "LATE" : "PRESENT";
    }

    // Fix checkout timestamp if it's real UTC (hour < 16 means old code ran)
    if (rec.checkOut && rec.checkOut.getUTCHours() < 16) {
      updates.checkOut = new Date(rec.checkOut.getTime() + PKT_OFFSET_MS);
    }

    // Fix checkIn if real UTC (hour < 8)
    if (rec.checkIn && rec.checkIn.getUTCHours() < 8) {
      updates.checkIn = new Date(rec.checkIn.getTime() + PKT_OFFSET_MS);
    }

    // Fix breakStart if real UTC
    if (rec.breakStart && rec.breakStart.getUTCHours() < 10) {
      updates.breakStart = new Date(rec.breakStart.getTime() + PKT_OFFSET_MS);
    }

    // Fix breakEnd if real UTC
    if (rec.breakEnd && rec.breakEnd.getUTCHours() < 12) {
      updates.breakEnd = new Date(rec.breakEnd.getTime() + PKT_OFFSET_MS);
    }

    // Recalculate workedMinutes with corrected timestamps
    const checkIn = updates.checkIn || rec.checkIn;
    const checkOut = updates.checkOut || rec.checkOut;
    const breakStart = updates.breakStart || rec.breakStart;
    const breakEnd = updates.breakEnd || rec.breakEnd;

    if (checkIn && checkOut) {
      let breakMin = 0;
      if (breakStart && breakEnd) {
        breakMin = Math.floor((breakEnd.getTime() - breakStart.getTime()) / (1000 * 60));
        if (breakMin < 0 || breakMin > 180) breakMin = 0;
      }
      const newWorked = Math.max(0, Math.floor((checkOut.getTime() - checkIn.getTime()) / (1000 * 60)) - breakMin);
      if (newWorked !== rec.workedMinutes) {
        updates.workedMinutes = newWorked;
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.attendance.update({ where: { id: rec.id }, data: updates });
      fixed++;
    }
  }

  // Delete any fines created today by auto-checkout (no-report, break-skip)
  // Since it was a power outage, not employee fault
  const deletedFines = await prisma.fine.deleteMany({
    where: {
      date: today,
      reason: { in: [
        "Daily report not submitted before auto-checkout",
        "Break skipped — did not log break attendance",
      ]},
    },
  });

  return json({
    message: `Fixed ${fixed} attendance records for today. Deleted ${deletedFines.count} auto-fines (power outage).`,
    totalRecords: records.length,
    fixed,
    finesDeleted: deletedFines.count,
  });
}
