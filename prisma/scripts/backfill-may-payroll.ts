import { PrismaClient } from "@prisma/client";
import { generatePayrollForEmployee } from "../../src/lib/services/payroll.service";

const prisma = new PrismaClient();

/**
 * Backfill May 2026 PayrollRecord rows for any HIRED/PROBATION employee
 * that's missing one. The seed-me-team and seed-ae-team scripts created the
 * users + salary structures via raw Prisma, which bypasses the auto-payroll
 * generation that POST /api/employees does. The dashboard's "Total Payable"
 * aggregation queries PayrollRecord directly, so missing rows = missing
 * employees in the dashboard total.
 *
 * This is idempotent — generatePayrollForEmployee upserts on
 * (userId, month, year) and skips PAID + locked records.
 */
async function main() {
  const month = 5;
  const year = 2026;

  // Use the CEO as generatedBy.
  const ceo = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (!ceo) throw new Error("No SUPER_ADMIN user found");

  const employees = await prisma.user.findMany({
    where: {
      role: "EMPLOYEE",
      status: { in: ["HIRED", "PROBATION"] },
      salaryStructure: { isNot: null },
    },
    select: { id: true, employeeId: true, firstName: true, lastName: true, status: true },
    orderBy: { employeeId: "asc" },
  });

  console.log(`Backfilling PayrollRecord for ${month}/${year} across ${employees.length} employees\n`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const emp of employees) {
    const existing = await prisma.payrollRecord.findUnique({
      where: { userId_month_year: { userId: emp.id, month, year } },
    });

    if (existing && (existing.status === "PAID" || existing.lockedAt)) {
      console.log(`  · ${emp.employeeId}  ${emp.firstName} (${existing.status}, locked) — skipped`);
      skipped++;
      continue;
    }

    try {
      const record = await generatePayrollForEmployee(emp.id, month, year, ceo.id);
      console.log(
        `  ${existing ? "↻" : "+"} ${emp.employeeId}  ${emp.firstName} ${emp.lastName || ""}`.trim() +
        `  [${emp.status}]  netSalary=PKR ${Number(record.netSalary).toLocaleString()}`,
      );
      generated++;
    } catch (err: any) {
      console.log(`  ✗ ${emp.employeeId}  ${emp.firstName} — ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n  ✅ Backfill complete — generated=${generated}, skipped=${skipped}, errors=${errors}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
