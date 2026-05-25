/**
 * Verify the Payroll page's "Total Fines" KPI is summing fines across
 * ALL teams (not just EM + FB-HQ as the CEO suspects). Produces:
 *
 *   1. Per-team breakdown:
 *        - employees in team
 *        - payroll records for the month
 *        - missing payroll records (count + names)
 *        - Σ PayrollRecord.totalFines (= what shows on Payroll page)
 *        - Σ live Fine rows (non-absent only — what SHOULD show)
 *        - drift between the two
 *
 *   2. Grand total reconciliation:
 *        - Payroll page KPI = Σ across all PayrollRecord.totalFines
 *        - Live truth      = Σ across all Fine rows (excl. absent)
 *        - Drift           = page KPI − live truth
 *
 *   3. Coverage check:
 *        - Total employees per department/team
 *        - Employees missing a PayrollRecord for the month
 *        - Any employee with a Fine but no PayrollRecord = leak
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const today = new Date(Date.now() + 5 * 60 * 60_000);
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();
  const monthEnd = new Date(Date.UTC(year, month, 0));

  console.log(`PAYROLL FINES COVERAGE AUDIT — ${month}/${year}`);
  console.log("═".repeat(120));

  // All employees who should be in payroll (matches the page's where clause)
  const employees = await prisma.user.findMany({
    where: {
      joiningDate: { lte: monthEnd },
      status: { notIn: ["RESIGNED"] },
      role: { not: "SUPER_ADMIN" },
    },
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      status: true,
      department: { select: { name: true } },
      team: { select: { name: true } },
      office: { select: { name: true } },
    },
    orderBy: { employeeId: "asc" },
  });

  const allFines = await prisma.fine.findMany({
    where: { month, year },
    select: { userId: true, amount: true, type: true },
  });

  const payrollRecords = await prisma.payrollRecord.findMany({
    where: { month, year },
    select: { userId: true, totalFines: true },
  });

  // Per-user maps
  const fineByUser = new Map<string, number>();
  for (const f of allFines) {
    if (f.type === "ABSENT_WITHOUT_LEAVE") continue;
    fineByUser.set(f.userId, (fineByUser.get(f.userId) ?? 0) + f.amount);
  }
  const recordByUser = new Map<string, number>();
  for (const r of payrollRecords) {
    recordByUser.set(r.userId, (recordByUser.get(r.userId) ?? 0) + r.totalFines);
  }
  const hasRecord = new Set(payrollRecords.map((r) => r.userId));

  // ─── Per-team grouping ────────────────────────────────────────────
  type TeamRow = {
    teamKey: string;
    label: string;
    empCount: number;
    recordCount: number;
    missingRecords: string[];      // employees with no PayrollRecord
    sumPagedFines: number;         // Σ PayrollRecord.totalFines for this team's emps
    sumLiveFines: number;          // Σ live Fine rows (non-absent) for this team's emps
  };
  const groups = new Map<string, TeamRow>();
  for (const emp of employees) {
    const key = `${emp.office?.name || "—"} / ${emp.department?.name || "—"}${emp.team ? " · " + emp.team.name : ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        teamKey: key,
        label: key,
        empCount: 0,
        recordCount: 0,
        missingRecords: [],
        sumPagedFines: 0,
        sumLiveFines: 0,
      };
      groups.set(key, g);
    }
    g.empCount++;
    if (hasRecord.has(emp.id)) {
      g.recordCount++;
    } else {
      g.missingRecords.push(`${emp.employeeId} ${emp.firstName} ${emp.lastName || ""}`.trim());
    }
    g.sumPagedFines += recordByUser.get(emp.id) ?? 0;
    g.sumLiveFines += fineByUser.get(emp.id) ?? 0;
  }

  // ─── Print per-team ───────────────────────────────────────────────
  console.log("");
  console.log(
    "Team".padEnd(40) + " | " +
    "Emp".padStart(4) + " | " +
    "Rec".padStart(4) + " | " +
    "Missing".padStart(7) + " | " +
    "Paged $".padStart(10) + " | " +
    "Live $".padStart(10) + " | " +
    "Drift".padStart(10)
  );
  console.log("─".repeat(120));

  let pagedTotal = 0;
  let liveTotal = 0;
  const sorted = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  for (const g of sorted) {
    const drift = g.sumPagedFines - g.sumLiveFines;
    pagedTotal += g.sumPagedFines;
    liveTotal += g.sumLiveFines;
    console.log(
      g.label.padEnd(40).slice(0, 40) + " | " +
      String(g.empCount).padStart(4) + " | " +
      String(g.recordCount).padStart(4) + " | " +
      String(g.missingRecords.length).padStart(7) + " | " +
      `${g.sumPagedFines.toFixed(0)}`.padStart(10) + " | " +
      `${g.sumLiveFines.toFixed(0)}`.padStart(10) + " | " +
      `${drift.toFixed(0)}`.padStart(10) + (Math.abs(drift) > 0.5 ? "  ✗" : "")
    );
  }
  console.log("─".repeat(120));
  console.log(
    "TOTAL".padEnd(40) + " | " +
    String(employees.length).padStart(4) + " | " +
    String(payrollRecords.length).padStart(4) + " | " +
    String(employees.length - payrollRecords.length).padStart(7) + " | " +
    `${pagedTotal.toFixed(0)}`.padStart(10) + " | " +
    `${liveTotal.toFixed(0)}`.padStart(10) + " | " +
    `${(pagedTotal - liveTotal).toFixed(0)}`.padStart(10)
  );

  // ─── Missing payroll records ──────────────────────────────────────
  const missingAll: string[] = [];
  for (const g of sorted) {
    if (g.missingRecords.length > 0) {
      console.log(`\n  Missing payroll records in ${g.label}:`);
      for (const name of g.missingRecords) {
        console.log(`    ✗ ${name}`);
        missingAll.push(name);
      }
    }
  }

  // ─── Leaks: people who have FINES but NO payroll record ───────────
  console.log("\nLEAK CHECK — employees with fines but no PayrollRecord:");
  let leaks = 0;
  for (const [userId, amt] of fineByUser.entries()) {
    if (!hasRecord.has(userId)) {
      const emp = employees.find((e) => e.id === userId);
      if (emp) {
        console.log(`  ✗ ${emp.employeeId} ${emp.firstName} ${emp.lastName || ""}: PKR ${amt} not counted in payroll KPI`);
        leaks++;
      }
    }
  }
  if (leaks === 0) console.log("  ✓ none");

  console.log("\n═".repeat(120));
  console.log(`Payroll page "Total Fines" KPI shows: PKR ${pagedTotal.toLocaleString()}`);
  console.log(`Live fines (non-absent) should be:     PKR ${liveTotal.toLocaleString()}`);
  console.log(`Drift:                                 PKR ${(pagedTotal - liveTotal).toFixed(2)}`);
  if (Math.abs(pagedTotal - liveTotal) > 0.5) {
    console.log(`\n✗ MISMATCH — payroll snapshots are stale relative to live fines.`);
    console.log(`  Re-generate payroll for the affected employees to sync.`);
  } else {
    console.log(`\n✓ KPI matches live fines exactly.`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
