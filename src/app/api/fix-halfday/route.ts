import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// One-time fix: correct all wrongly marked HALF_DAY records back to PRESENT/LATE
// DELETE THIS FILE after running once
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  // Find all HALF_DAY attendance records that were NOT from a leave request
  const halfDayRecords = await prisma.attendance.findMany({
    where: { status: "HALF_DAY" },
    select: { id: true, userId: true, date: true, lateMinutes: true },
  });

  let fixed = 0;
  let skipped = 0;

  for (const att of halfDayRecords) {
    // Check if this half day was from a manual leave request
    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: {
        userId: att.userId,
        startDate: att.date,
        leaveType: "HALF_DAY",
        status: { in: ["APPROVED", "PENDING"] },
      },
    });

    if (leaveRequest) {
      // This was a legitimate half-day leave — keep it
      skipped++;
      continue;
    }

    // No leave request — this was wrongly marked by auto-checkout bug
    // Restore to PRESENT or LATE based on lateMinutes
    const correctStatus = att.lateMinutes && att.lateMinutes > 0 ? "LATE" : "PRESENT";
    await prisma.attendance.update({
      where: { id: att.id },
      data: { status: correctStatus },
    });
    fixed++;
  }

  return json({
    message: `Fixed ${fixed} records, skipped ${skipped} legitimate half-days`,
    total: halfDayRecords.length,
    fixed,
    skipped,
  });
}
