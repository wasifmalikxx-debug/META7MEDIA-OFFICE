import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// One-time fix: shift all old UTC timestamps to PKT-shifted format
// Old records stored checkIn/checkOut as real UTC (before nowPKT() fix)
// New records store as PKT-shifted (UTC+5). This migrates old to match new.
// DELETE THIS FILE after running once.
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const PKT_OFFSET_MS = 5 * 60 * 60_000;

  // Get all attendance records
  const records = await prisma.attendance.findMany({
    select: { id: true, checkIn: true, checkOut: true, breakStart: true, breakEnd: true },
  });

  let fixed = 0;

  for (const rec of records) {
    const updates: any = {};
    let needsUpdate = false;

    // Heuristic: if checkIn UTC hour is < 8 (before 8 AM UTC = 1 PM PKT),
    // it's likely a real UTC value that needs +5h shift.
    // PKT-shifted values would have UTC hour >= 10 (for 10:30 AM PKT check-in)
    if (rec.checkIn) {
      const h = rec.checkIn.getUTCHours();
      if (h < 8) {
        updates.checkIn = new Date(rec.checkIn.getTime() + PKT_OFFSET_MS);
        needsUpdate = true;
      }
    }

    if (rec.checkOut) {
      const h = rec.checkOut.getUTCHours();
      if (h < 16) { // Real UTC checkout at 14:00 (7PM PKT) → shift to 19:00
        updates.checkOut = new Date(rec.checkOut.getTime() + PKT_OFFSET_MS);
        needsUpdate = true;
      }
    }

    if (rec.breakStart) {
      const h = rec.breakStart.getUTCHours();
      if (h < 10) { // Real UTC break at 10:00 (3PM PKT) → shift to 15:00
        updates.breakStart = new Date(rec.breakStart.getTime() + PKT_OFFSET_MS);
        needsUpdate = true;
      }
    }

    if (rec.breakEnd) {
      const h = rec.breakEnd.getUTCHours();
      if (h < 12) { // Real UTC break end at 11:00 (4PM PKT) → shift to 16:00
        updates.breakEnd = new Date(rec.breakEnd.getTime() + PKT_OFFSET_MS);
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await prisma.attendance.update({
        where: { id: rec.id },
        data: updates,
      });
      fixed++;
    }
  }

  return json({
    message: `Migrated ${fixed} records from UTC to PKT-shifted format`,
    total: records.length,
    fixed,
    unchanged: records.length - fixed,
  });
}
