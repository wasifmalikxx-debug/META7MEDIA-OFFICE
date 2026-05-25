/**
 * HISTORICAL leave-budget leak scan.
 *
 * For every month since SYS_START (2026-04-01), list every employee
 * who had auto-paid absence + half-day adding up to MORE than the
 * monthly entitlement.
 *
 * Output: per-employee, per-month overflow, plus an estimated PKR
 * value of the "free" overflow (overflowDays × salary/30).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Leak {
  employeeId: string;
  name: string;
  month: number;
  year: number;
  absent: number;
  halfDays: number;
  used: number;
  budget: number;
  overflow: number;
  monthlySalary: number;
  estimatedFreePKR: number;
}

async function main() {
  const SYS_START_YEAR = 2026;
  const SYS_START_MONTH = 4; // April 2026
  const today = new Date(Date.now() + 5 * 60 * 60_000);
  const NOW_YEAR = today.getUTCFullYear();
  const NOW_MONTH = today.getUTCMonth() + 1;

  console.log(`HISTORICAL LEAVE-BUDGET LEAK SCAN`);
  console.log(`Scanning ${SYS_START_MONTH}/${SYS_START_YEAR} → ${NOW_MONTH}/${NOW_YEAR}`);
  console.log("═".repeat(115));

  const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
  const budget = settings?.paidLeavesPerMonth ?? 1.0;
  console.log(`Monthly entitlement: ${budget} day(s) (unified pool — fix landed 2026-05-25)\n`);

  const allEmps = await prisma.user.findMany({
    where: { status: { in: ["HIRED", "PROBATION"] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      salaryStructure: { select: { monthlySalary: true } },
    },
  });

  const leaks: Leak[] = [];

  // Iterate every month from SYS_START to current month
  let y = SYS_START_YEAR;
  let m = SYS_START_MONTH;
  while (y < NOW_YEAR || (y === NOW_YEAR && m <= NOW_MONTH)) {
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0));

    for (const emp of allEmps) {
      const ac = await prisma.fine.count({
        where: {
          userId: emp.id,
          type: "ABSENT_WITHOUT_LEAVE",
          month: m,
          year: y,
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
        const monthlySalary = emp.salaryStructure?.monthlySalary || 0;
        const overflow = used - budget;
        leaks.push({
          employeeId: emp.employeeId || "?",
          name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
          month: m,
          year: y,
          absent: ac,
          halfDays: hd,
          used,
          budget,
          overflow,
          monthlySalary,
          estimatedFreePKR: Math.round((monthlySalary / 30) * overflow),
        });
      }
    }

    m++;
    if (m > 12) { m = 1; y++; }
  }

  if (leaks.length === 0) {
    console.log("✓ No leaks found across any month.");
    return;
  }

  // Sort by month desc, then by employee
  leaks.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return a.employeeId.localeCompare(b.employeeId);
  });

  console.log(
    "Month".padEnd(8) +
      " | " +
      "Emp".padEnd(7) +
      " | " +
      "Name".padEnd(22) +
      " | " +
      "Absent".padStart(7) +
      " | " +
      "HalfDay".padStart(8) +
      " | " +
      "Used".padStart(5) +
      " | " +
      "Over".padStart(5) +
      " | " +
      "Salary".padStart(8) +
      " | " +
      "Free PKR".padStart(10),
  );
  console.log("─".repeat(115));
  for (const l of leaks) {
    console.log(
      `${(l.month + "/" + l.year).padEnd(8)} | ${l.employeeId.padEnd(7)} | ${l.name.padEnd(22).slice(0, 22)} | ${String(l.absent).padStart(7)} | ${String(l.halfDays).padStart(8)} | ${String(l.used).padStart(5)} | ${String(l.overflow).padStart(5)} | ${String(l.monthlySalary).padStart(8)} | ${l.estimatedFreePKR.toLocaleString().padStart(10)}`,
    );
  }

  // Totals per employee
  console.log("\n" + "═".repeat(115));
  console.log("TOTAL OVERFLOW PER EMPLOYEE (all months combined)");
  console.log("─".repeat(115));
  const perEmp = new Map<string, { name: string; months: number; totalOverflow: number; totalFreePKR: number }>();
  for (const l of leaks) {
    const k = l.employeeId;
    const cur = perEmp.get(k) || { name: l.name, months: 0, totalOverflow: 0, totalFreePKR: 0 };
    cur.months++;
    cur.totalOverflow += l.overflow;
    cur.totalFreePKR += l.estimatedFreePKR;
    perEmp.set(k, cur);
  }
  const sorted = [...perEmp.entries()].sort((a, b) => b[1].totalFreePKR - a[1].totalFreePKR);
  console.log(
    "Emp".padEnd(7) +
      " | " +
      "Name".padEnd(22) +
      " | " +
      "Months".padStart(7) +
      " | " +
      "Days over".padStart(10) +
      " | " +
      "Free PKR total".padStart(15),
  );
  console.log("─".repeat(115));
  for (const [empId, v] of sorted) {
    console.log(
      `${empId.padEnd(7)} | ${v.name.padEnd(22).slice(0, 22)} | ${String(v.months).padStart(7)} | ${String(v.totalOverflow).padStart(10)} | ${v.totalFreePKR.toLocaleString().padStart(15)}`,
    );
  }
  const grandTotal = sorted.reduce((s, [, v]) => s + v.totalFreePKR, 0);
  console.log("─".repeat(115));
  console.log(`Grand total "free" overflow across all employees, all months: PKR ${grandTotal.toLocaleString()}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
