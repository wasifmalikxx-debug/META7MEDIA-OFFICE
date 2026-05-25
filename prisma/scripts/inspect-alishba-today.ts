/**
 * Print Alishba EM-1's full state for today (PKT) so we know exactly
 * what to undo:
 *   - LeaveRequest rows for today
 *   - Attendance row for today (checkIn, checkOut, break, status)
 *   - Any DailyReport, Fine, or notification touching today
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const y = pkt.getUTCFullYear();
  const m = pkt.getUTCMonth();
  const d = pkt.getUTCDate();
  const today = new Date(Date.UTC(y, m, d));
  const todayStr = today.toISOString().split("T")[0];

  console.log(`ALISHBA EM-1 — state for ${todayStr} (PKT)`);
  console.log("═".repeat(90));

  const alishba = await prisma.user.findFirst({
    where: { employeeId: "EM-1" },
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  });
  if (!alishba) { console.log("EM-1 not found"); return; }
  console.log(`User: ${alishba.firstName} ${alishba.lastName} (${alishba.id})\n`);

  // Leave requests today
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      userId: alishba.id,
      startDate: { lte: today },
      endDate: { gte: today },
    },
    select: {
      id: true, leaveType: true, halfDayPeriod: true,
      startDate: true, endDate: true, totalDays: true,
      reason: true, status: true, createdAt: true, approverId: true,
    },
  });
  console.log("LEAVE REQUESTS active today:");
  if (leaves.length === 0) console.log("  (none)");
  for (const l of leaves) {
    console.log(`  id: ${l.id}`);
    console.log(`    type:    ${l.leaveType} ${l.halfDayPeriod || ""}`);
    console.log(`    dates:   ${l.startDate.toISOString().split("T")[0]} → ${l.endDate.toISOString().split("T")[0]}`);
    console.log(`    days:    ${l.totalDays}`);
    console.log(`    reason:  ${l.reason}`);
    console.log(`    status:  ${l.status}`);
    console.log(`    filed:   ${l.createdAt.toISOString()}`);
  }
  console.log("");

  // Attendance today
  const att = await prisma.attendance.findFirst({
    where: { userId: alishba.id, date: today },
  });
  console.log("ATTENDANCE today:");
  if (!att) console.log("  (no row yet)");
  else {
    console.log(`  id:             ${att.id}`);
    console.log(`  status:         ${att.status}`);
    console.log(`  checkIn:        ${att.checkIn?.toISOString() || "(null)"}`);
    console.log(`  checkOut:       ${att.checkOut?.toISOString() || "(null)"}`);
    console.log(`  breakStart:     ${att.breakStart?.toISOString() || "(null)"}`);
    console.log(`  breakEnd:       ${att.breakEnd?.toISOString() || "(null)"}`);
    console.log(`  workedMinutes:  ${att.workedMinutes ?? "(null)"}`);
    console.log(`  lateMinutes:    ${att.lateMinutes ?? "(null)"}`);
  }
  console.log("");

  // Daily report today
  const dr = await prisma.dailyReport.findFirst({
    where: { userId: alishba.id, date: today },
    select: { id: true, createdAt: true, notes: true },
  });
  console.log("DAILY REPORT today:");
  if (!dr) console.log("  (none)");
  else {
    console.log(`  id: ${dr.id}, created: ${dr.createdAt?.toISOString()}`);
    console.log(`  notes (first 100): ${(dr.notes || "").slice(0, 100)}`);
  }
  console.log("");

  // Office settings — for context (break duration etc)
  const settings = await prisma.officeSettings.findFirst({
    where: { office: { users: { some: { id: alishba.id } } } },
    select: {
      paidLeavesPerMonth: true,
      halfDayThresholdMin: true,
      breakDurationMin: true,
      workStartTime: true,
      workEndTime: true,
    },
  });
  console.log("OFFICE SETTINGS (for context):");
  console.log(`  paidLeavesPerMonth:  ${settings?.paidLeavesPerMonth}`);
  console.log(`  halfDayThresholdMin: ${settings?.halfDayThresholdMin}`);
  console.log(`  breakDurationMin:    ${settings?.breakDurationMin}`);
  console.log(`  workStartTime:       ${settings?.workStartTime}`);
  console.log(`  workEndTime:         ${settings?.workEndTime}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
