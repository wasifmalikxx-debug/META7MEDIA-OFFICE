import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { pktMonth, pktYear } from "@/lib/pkt";

// Comprehensive fix: fix all known issues in one endpoint
// DELETE THIS FILE after running
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const month = pktMonth();
  const year = pktYear();
  const results: string[] = [];

  // 1. Fix ALL HALF_DAY attendance records that don't have matching leave requests
  const halfDayRecords = await prisma.attendance.findMany({
    where: { status: "HALF_DAY" },
    select: { id: true, userId: true, date: true, lateMinutes: true },
  });
  let hdFixed = 0;
  for (const att of halfDayRecords) {
    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: { userId: att.userId, startDate: att.date, leaveType: "HALF_DAY", status: { in: ["APPROVED", "PENDING"] } },
    });
    if (!leaveRequest) {
      const correctStatus = att.lateMinutes && att.lateMinutes > 0 ? "LATE" : "PRESENT";
      await prisma.attendance.update({ where: { id: att.id }, data: { status: correctStatus } });
      hdFixed++;
    }
  }
  results.push(`Fixed ${hdFixed} wrongly-marked HALF_DAY records`);

  // 2. Delete ALL old covered absence fines (they drain the budget incorrectly)
  const deletedCovered = await prisma.fine.deleteMany({
    where: { amount: 0, reason: { contains: "Covered by paid leave" } },
  });
  results.push(`Deleted ${deletedCovered.count} old covered absence fines`);

  // 3. Fix timestamps: shift any remaining old UTC timestamps to PKT
  const PKT_OFFSET_MS = 5 * 60 * 60_000;
  const allAtt = await prisma.attendance.findMany({
    select: { id: true, checkIn: true, checkOut: true, breakStart: true, breakEnd: true, workedMinutes: true },
  });
  let tsFixed = 0;
  for (const rec of allAtt) {
    const updates: any = {};
    let needsUpdate = false;
    if (rec.checkIn && rec.checkIn.getUTCHours() < 8) { updates.checkIn = new Date(rec.checkIn.getTime() + PKT_OFFSET_MS); needsUpdate = true; }
    if (rec.checkOut && rec.checkOut.getUTCHours() < 16) { updates.checkOut = new Date(rec.checkOut.getTime() + PKT_OFFSET_MS); needsUpdate = true; }
    if (rec.breakStart && rec.breakStart.getUTCHours() < 10) { updates.breakStart = new Date(rec.breakStart.getTime() + PKT_OFFSET_MS); needsUpdate = true; }
    if (rec.breakEnd && rec.breakEnd.getUTCHours() < 12) { updates.breakEnd = new Date(rec.breakEnd.getTime() + PKT_OFFSET_MS); needsUpdate = true; }
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
      if (newWorked !== rec.workedMinutes) { updates.workedMinutes = newWorked; needsUpdate = true; }
    }
    if (needsUpdate) { await prisma.attendance.update({ where: { id: rec.id }, data: updates }); tsFixed++; }
  }
  results.push(`Fixed ${tsFixed} timestamp/workedMinutes records`);

  // 4. Regenerate payroll for this month
  const { generatePayrollForAll } = await import("@/lib/services/payroll.service");
  const payroll = await generatePayrollForAll(month, year, session.user.id);
  results.push(`Regenerated payroll for ${payroll.length} employees`);

  return json({ message: "All fixes applied", results });
}
