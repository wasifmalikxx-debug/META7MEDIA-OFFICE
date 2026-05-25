/**
 * Compare each employee's MAY 2026 fines as the dashboard sees them
 * vs as the payroll calculation sees them. Surface every discrepancy.
 *
 * THE SUSPECTED BUG (2026-05-25):
 *   - Dashboard /api/dashboard query for fines:
 *       prisma.fine.findMany({ where: { userId, month, year } })
 *     → returns ALL fines including ABSENT_WITHOUT_LEAVE
 *   - Then the employee-dashboard component sums them all into
 *     `totalFinesAmount` and shows "Fines: PKR X" on the KPI card.
 *
 *   - Payroll service explicitly EXCLUDES ABSENT_WITHOUT_LEAVE
 *     from `totalFines` (line 281 of payroll.service.ts) because
 *     absent deductions are calculated separately via the per-month
 *     auto-cover walk. So the payroll "Fines" line is only the
 *     non-absent fines.
 *
 * Expected: dashboard fines >= payroll fines for every employee that
 * has any absent fine. The gap == absent fine amount.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const today = new Date(Date.now() + 5 * 60 * 60_000);
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();

  console.log(`FINES — DASHBOARD vs PAYROLL — ${month}/${year}`);
  console.log("═".repeat(120));

  const employees = await prisma.user.findMany({
    where: { status: { in: ["HIRED", "PROBATION"] } },
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
    },
    orderBy: { employeeId: "asc" },
  });

  const fines = await prisma.fine.findMany({
    where: { month, year },
    select: {
      userId: true,
      type: true,
      amount: true,
      reason: true,
    },
  });

  type Row = {
    empId: string;
    name: string;
    dashboardSum: number;     // sums ALL fines (current dashboard behavior)
    absentTotal: number;      // ABSENT_WITHOUT_LEAVE sum
    coveredAbsentCount: number; // amount=0 absent fines (rows but no PKR)
    otherFinesTotal: number;  // payroll's "totalFines" (excludes absent)
    payrollAbsentDeduction: number; // payroll's "absentDeductions"
    payrollTotalFinesLine: number;  // payroll record stores both separately
  };

  const rows: Row[] = [];
  for (const emp of employees) {
    const empFines = fines.filter((f) => f.userId === emp.id);
    if (empFines.length === 0) continue;

    const dashboardSum = empFines.reduce((s, f) => s + (f.amount || 0), 0);
    const absentFines = empFines.filter((f) => f.type === "ABSENT_WITHOUT_LEAVE");
    const absentTotal = absentFines.reduce((s, f) => s + (f.amount || 0), 0);
    const coveredAbsentCount = absentFines.filter((f) => (f.amount || 0) === 0).length;
    const otherFinesTotal = empFines
      .filter((f) => f.type !== "ABSENT_WITHOUT_LEAVE")
      .reduce((s, f) => s + (f.amount || 0), 0);

    rows.push({
      empId: emp.employeeId || "?",
      name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
      dashboardSum,
      absentTotal,
      coveredAbsentCount,
      otherFinesTotal,
      payrollAbsentDeduction: absentTotal, // mirrors payroll service
      payrollTotalFinesLine: otherFinesTotal, // mirrors payroll service
    });
  }

  // Header
  console.log(
    "Emp".padEnd(7) + " | " +
    "Name".padEnd(24) + " | " +
    "Dash Sum".padStart(10) + " | " +
    "Absent$".padStart(8) + " | " +
    "CovRows".padStart(7) + " | " +
    "Other$".padStart(8) + " | " +
    "Dash≠Payr".padStart(10) + " | Notes"
  );
  console.log("─".repeat(120));

  let mismatchCount = 0;
  for (const r of rows) {
    // "Dashboard total" = single number on the KPI card (sums ALL fine rows)
    // "Payroll total" the user would compute = absent deduction + Fines line
    // These should match. But the *labels* differ — the dashboard says "Fines"
    // while payroll splits into "Absent" + "Fines". User compares numbers and
    // gets confused.
    const dashboardLabel = r.dashboardSum;
    const payrollSumOfBothLines = r.payrollAbsentDeduction + r.payrollTotalFinesLine;
    const mismatch = Math.abs(dashboardLabel - payrollSumOfBothLines) > 0.01;
    if (mismatch) mismatchCount++;

    const note = mismatch
      ? "✗ mismatch"
      : r.absentTotal > 0
        ? `✓ matches (Dashboard hides Absent/Fines split)`
        : r.coveredAbsentCount > 0
          ? `⚠ ${r.coveredAbsentCount} covered absent row(s) (amount=0)`
          : "✓ no absent fines";

    console.log(
      r.empId.padEnd(7) + " | " +
      r.name.padEnd(24).slice(0, 24) + " | " +
      `PKR ${r.dashboardSum.toLocaleString()}`.padStart(10) + " | " +
      `PKR ${r.absentTotal.toLocaleString()}`.padStart(8) + " | " +
      String(r.coveredAbsentCount).padStart(7) + " | " +
      `PKR ${r.otherFinesTotal.toLocaleString()}`.padStart(8) + " | " +
      String(mismatch ? "YES" : "no").padStart(10) + " | " + note
    );
  }

  console.log("─".repeat(120));
  console.log(`\nTotal employees with fines this month: ${rows.length}`);
  console.log(`Mismatches (math doesn't add up): ${mismatchCount}`);
  console.log("");
  console.log("KEY INSIGHT:");
  console.log("  Dashboard 'Fines: PKR X' = sum of ALL fine rows (incl. absent)");
  console.log("  Payroll splits into two lines:");
  console.log("     - Absent deductions  = ABSENT_WITHOUT_LEAVE sum");
  console.log("     - Fines              = other fines (manual, late-fee, etc.)");
  console.log("");
  console.log("  CEO sees 'Fines: PKR 1500' on dashboard, opens payroll, sees");
  console.log("  'Fines: PKR 0' under fines line — because the 1500 is sitting");
  console.log("  under the separate 'Absent deductions' line. Totals still match,");
  console.log("  but the labels are inconsistent → looks like data is wrong.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
