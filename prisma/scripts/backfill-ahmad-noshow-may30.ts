/**
 * ONE-OFF ADMIN ACTION (2026-05-31, CEO request):
 *
 * SMM-2 M. Ahmad Aslam (Zain's FB-O2 team) filed an APPROVED
 * HALF_DAY FIRST_HALF leave for May 30 and never checked in for
 * the SECOND_HALF he was supposed to work. Under the new
 * "no-show on working half" rule (commit landing today), he
 * should owe a 0.5 × dailyRate fine. This script applies that
 * fine retroactively so May payroll reflects it.
 *
 * Symmetric with the cron logic — same fine type, same reason
 * format, same idempotency check. Safe to re-run.
 *
 * Run:
 *   DATABASE_URL=$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"') \
 *     npx tsx prisma/scripts/backfill-ahmad-noshow-may30.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const targetDate = new Date(Date.UTC(2026, 4, 30)); // 2026-05-30 (month is 0-indexed)
  const month = 5;
  const year = 2026;

  const ahmad = await prisma.user.findFirst({
    where: { employeeId: "SMM-2" },
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      salaryStructure: { select: { monthlySalary: true } },
    },
  });
  if (!ahmad) {
    console.error("SMM-2 not found");
    process.exit(1);
  }
  console.log(`Subject: ${ahmad.firstName} ${ahmad.lastName || ""} (${ahmad.employeeId})`);
  console.log(`User ID: ${ahmad.id}`);
  console.log("");

  // Verify the precondition: APPROVED HALF_DAY FIRST_HALF for May 30
  const leave = await prisma.leaveRequest.findFirst({
    where: {
      userId: ahmad.id,
      startDate: { lte: targetDate },
      endDate: { gte: targetDate },
      status: "APPROVED",
      leaveType: "HALF_DAY",
    },
    select: { id: true, halfDayPeriod: true, reason: true },
  });
  if (!leave) {
    console.error("No approved half-day leave found for 2026-05-30. Refusing to backfill.");
    process.exit(1);
  }
  console.log(`Approved leave: HALF_DAY ${leave.halfDayPeriod}`);
  console.log(`Reason on file: "${leave.reason.slice(0, 80)}..."`);
  console.log("");

  // Verify attendance row state — must be HALF_DAY + no check-in
  const att = await prisma.attendance.findFirst({
    where: { userId: ahmad.id, date: targetDate },
  });
  if (!att) {
    console.error("No attendance row for 2026-05-30. Refusing to backfill — would create inconsistent state.");
    process.exit(1);
  }
  console.log(`Attendance: status=${att.status}, checkIn=${att.checkIn?.toISOString() ?? "NULL"}`);
  if (att.status !== "HALF_DAY" || att.checkIn !== null) {
    console.error("Attendance doesn't match the no-show pattern (status≠HALF_DAY or checkIn already set). Refusing to backfill.");
    process.exit(1);
  }
  console.log("");

  // Idempotency: skip if a no-show fine already exists for that date
  const existing = await prisma.fine.findFirst({
    where: {
      userId: ahmad.id,
      date: targetDate,
      type: "ABSENT_WITHOUT_LEAVE",
      reason: { contains: "No-show on working half" },
    },
  });
  if (existing) {
    console.log(`✓ No-show fine already exists (id ${existing.id}, PKR ${existing.amount}). Nothing to do.`);
    return;
  }

  // Compute the fine
  const monthlySalary = ahmad.salaryStructure?.monthlySalary || 0;
  if (monthlySalary <= 0) {
    console.error("Ahmad has no salary structure. Refusing to backfill.");
    process.exit(1);
  }
  const halfDayFine = Math.round((monthlySalary / 30) * 0.5);
  const skippedHalf =
    leave.halfDayPeriod === "FIRST_HALF" ? "SECOND_HALF" : "FIRST_HALF";
  const fineReason =
    `No-show on working half of approved ${leave.halfDayPeriod} leave — ` +
    `${skippedHalf} not attended — PKR ${halfDayFine.toLocaleString()} ` +
    `(salary/30 × 0.5) deducted`;

  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });

  console.log(`Will create fine:`);
  console.log(`  Date:   2026-05-30`);
  console.log(`  Type:   ABSENT_WITHOUT_LEAVE`);
  console.log(`  Amount: PKR ${halfDayFine.toLocaleString()}`);
  console.log(`  Reason: ${fineReason}`);
  console.log("");

  const created = await prisma.fine.create({
    data: {
      userId: ahmad.id,
      type: "ABSENT_WITHOUT_LEAVE",
      amount: halfDayFine,
      reason: fineReason,
      date: targetDate,
      month,
      year,
      issuedById: admin?.id || ahmad.id,
    },
    select: { id: true, amount: true },
  });
  console.log(`✓ Created fine id ${created.id} for PKR ${created.amount}`);
  console.log("");
  console.log("Run diag-payroll-fines-coverage.ts to confirm the May Total Fines KPI increased by this amount.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
