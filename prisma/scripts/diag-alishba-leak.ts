/**
 * Diagnostic for the Alishba (EM-1) leave-budget leak — May 25 2026.
 *
 * What the CEO reported:
 *   • Alishba's May 9 absence was auto-covered (consumed her monthly leave).
 *   • She filed a half-day on May 25.
 *   • System allowed it — but her budget should have been exhausted.
 *
 * What this script prints:
 *   1. All of Alishba's covered-absence fines this month (consumed budget A)
 *   2. All her half-day leave requests this month         (consumed budget B)
 *   3. The unified total she used vs the monthly entitlement
 *   4. How many other employees fleet-wide have the same pattern
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const today = new Date(Date.now() + 5 * 60 * 60_000);
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  console.log(`LEAVE-BUDGET LEAK AUDIT — ${month}/${year}`);
  console.log("═".repeat(100));

  const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
  const budget = settings?.paidLeavesPerMonth ?? 1.0;
  console.log(`Monthly entitlement: ${budget} day(s)\n`);

  // ─── Alishba ───
  const alishba = await prisma.user.findFirst({
    where: { employeeId: "EM-1" },
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  });
  if (!alishba) {
    console.log("EM-1 not found");
    return;
  }

  console.log(`SUBJECT: ${alishba.firstName} ${alishba.lastName} (${alishba.employeeId})`);
  console.log("─".repeat(100));

  const coveredAbsents = await prisma.fine.findMany({
    where: {
      userId: alishba.id,
      type: "ABSENT_WITHOUT_LEAVE",
      month,
      year,
      reason: { contains: "Covered by paid leave" },
    },
    select: { date: true, reason: true, amount: true },
    orderBy: { date: "asc" },
  });
  console.log(`\nCovered absences (consumes leave budget):`);
  for (const f of coveredAbsents) {
    console.log(`  ${f.date.toISOString().split("T")[0]} — ${f.reason} — fine PKR ${f.amount}`);
  }
  const absentBudgetUsed = coveredAbsents.length * 1.0;

  const halfDays = await prisma.leaveRequest.findMany({
    where: {
      userId: alishba.id,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: monthStart, lte: monthEnd },
    },
    select: { startDate: true, reason: true, totalDays: true, createdAt: true },
    orderBy: { startDate: "asc" },
  });
  console.log(`\nHalf-day leaves (each = 0.5 budget):`);
  for (const l of halfDays) {
    console.log(`  ${l.startDate.toISOString().split("T")[0]} — ${l.reason} — ${l.totalDays}d (filed ${l.createdAt.toISOString().split("T")[0]})`);
  }
  const halfDayBudgetUsed = halfDays.length * 0.5;

  const totalUsed = absentBudgetUsed + halfDayBudgetUsed;
  const overflow = Math.max(0, totalUsed - budget);
  console.log(`\nUnified budget tally:`);
  console.log(`  Budget:        ${budget}`);
  console.log(`  Absent used:   ${absentBudgetUsed}`);
  console.log(`  Half-day used: ${halfDayBudgetUsed}`);
  console.log(`  Total used:    ${totalUsed}`);
  console.log(`  Overflow:      ${overflow}  ${overflow > 0 ? "  ← BUDGET BREACHED" : ""}`);

  // ─── Fleet-wide scan ───
  console.log(`\n\nFLEET-WIDE SCAN — anyone else over budget?`);
  console.log("─".repeat(100));

  const allEmps = await prisma.user.findMany({
    where: { status: { in: ["HIRED", "PROBATION"] } },
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  });

  let leakCount = 0;
  for (const emp of allEmps) {
    const ac = await prisma.fine.count({
      where: {
        userId: emp.id,
        type: "ABSENT_WITHOUT_LEAVE",
        month,
        year,
        reason: { contains: "Covered by paid leave" },
      },
    });
    const hd = await prisma.leaveRequest.count({
      where: {
        userId: emp.id,
        leaveType: "HALF_DAY",
        status: "APPROVED",
        startDate: { gte: monthStart, lte: monthEnd },
      },
    });
    const used = ac * 1.0 + hd * 0.5;
    if (used > budget) {
      leakCount++;
      console.log(
        `  ✗ ${(emp.employeeId || "?").padEnd(8)} ${(emp.firstName + " " + (emp.lastName || "")).padEnd(25)} — ${ac} absent + ${hd} half = ${used} (over by ${used - budget})`,
      );
    }
  }
  console.log(`\n${leakCount} employees over budget this month.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
