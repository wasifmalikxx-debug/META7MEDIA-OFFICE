import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// One-time fix: shift old UTC timestamps to PKT-shifted format AND recalculate workedMinutes
// DELETE THIS FILE after running
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const PKT_OFFSET_MS = 5 * 60 * 60_000;

  const records = await prisma.attendance.findMany({
    select: { id: true, checkIn: true, checkOut: true, breakStart: true, breakEnd: true, workedMinutes: true },
  });

  let fixedTimestamps = 0;
  let fixedWorkedMin = 0;

  for (const rec of records) {
    const updates: any = {};
    let needsUpdate = false;

    // Fix checkIn: if UTC hour < 8, it's real UTC (before nowPKT fix)
    if (rec.checkIn && rec.checkIn.getUTCHours() < 8) {
      updates.checkIn = new Date(rec.checkIn.getTime() + PKT_OFFSET_MS);
      needsUpdate = true;
    }

    // Fix checkOut: if UTC hour < 16, it's real UTC
    if (rec.checkOut && rec.checkOut.getUTCHours() < 16) {
      updates.checkOut = new Date(rec.checkOut.getTime() + PKT_OFFSET_MS);
      needsUpdate = true;
    }

    // Fix breakStart: if UTC hour < 10, it's real UTC
    if (rec.breakStart && rec.breakStart.getUTCHours() < 10) {
      updates.breakStart = new Date(rec.breakStart.getTime() + PKT_OFFSET_MS);
      needsUpdate = true;
    }

    // Fix breakEnd: if UTC hour < 12, it's real UTC
    if (rec.breakEnd && rec.breakEnd.getUTCHours() < 12) {
      updates.breakEnd = new Date(rec.breakEnd.getTime() + PKT_OFFSET_MS);
      needsUpdate = true;
    }

    if (needsUpdate) {
      fixedTimestamps++;
    }

    // Recalculate workedMinutes using corrected timestamps
    const checkIn = updates.checkIn || rec.checkIn;
    const checkOut = updates.checkOut || rec.checkOut;
    const breakStart = updates.breakStart || rec.breakStart;
    const breakEnd = updates.breakEnd || rec.breakEnd;

    if (checkIn && checkOut) {
      let breakMin = 0;
      if (breakStart && breakEnd) {
        breakMin = Math.floor((breakEnd.getTime() - breakStart.getTime()) / (1000 * 60));
        if (breakMin < 0 || breakMin > 180) breakMin = 0; // sanity check
      }
      const newWorked = Math.max(0, Math.floor((checkOut.getTime() - checkIn.getTime()) / (1000 * 60)) - breakMin);

      if (newWorked !== rec.workedMinutes) {
        updates.workedMinutes = newWorked;
        fixedWorkedMin++;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await prisma.attendance.update({ where: { id: rec.id }, data: updates });
    }
  }

  return json({
    message: `Fixed ${fixedTimestamps} timestamps, recalculated ${fixedWorkedMin} worked minutes`,
    total: records.length,
    fixedTimestamps,
    fixedWorkedMin,
  });
}
