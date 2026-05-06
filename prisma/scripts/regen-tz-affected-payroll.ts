/**
 * One-off: regenerate the April 2026 payroll records for the two employees
 * that were 1-day under-paid by the TZ proration bug. After fixing the
 * bug in payroll.service.ts, this regen produces the corrected numbers.
 *
 * Targets EM-1 (Alishba Qaiser) and SMM-10 (Muhammad Shoaib). Both are
 * still status=DRAFT, never paid, so regenerating is non-destructive.
 *
 * Safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { generatePayrollForEmployee } from "../../src/lib/services/payroll.service";

const prisma = new PrismaClient();

async function main() {
  const targets = await prisma.user.findMany({
    where: { employeeId: { in: ["EM-1", "SMM-10"] } },
    select: { id: true, employeeId: true, firstName: true, lastName: true },
  });

  if (targets.length === 0) {
    console.log("No targets found.");
    return;
  }

  // Find an admin to credit as `generatedBy`.
  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  if (!admin) {
    console.error("No SUPER_ADMIN user found — can't regen.");
    return;
  }

  for (const t of targets) {
    console.log(`Regenerating ${t.employeeId} (${t.firstName} ${t.lastName || ""}) for April 2026...`);
    const before = await prisma.payrollRecord.findUnique({
      where: { userId_month_year: { userId: t.id, month: 4, year: 2026 } },
    });
    console.log(`  before: earnedSalary=${(before as any)?.earnedSalary} netSalary=${before?.netSalary}`);

    await generatePayrollForEmployee(t.id, 4, 2026, admin.id);

    const after = await prisma.payrollRecord.findUnique({
      where: { userId_month_year: { userId: t.id, month: 4, year: 2026 } },
    });
    console.log(`  after:  earnedSalary=${(after as any)?.earnedSalary} netSalary=${after?.netSalary}`);
    console.log("");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
