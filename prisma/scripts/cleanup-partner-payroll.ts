/**
 * One-off cleanup: partners (Awais / Mubeen / Zain) accidentally got
 * salaryStructure + payrollRecord rows when the CEO edited them through
 * the Employees form. Partners aren't on payroll, so those rows are
 * noise — they make the CEO's payroll list show "PKR 0" entries and
 * inflate the employee count.
 *
 * Safe to re-run: deletes only PARTNER-role rows. The Edit dialog and
 * PATCH API have been guarded to stop creating these going forward.
 *
 * Usage:
 *   npx tsx prisma/scripts/cleanup-partner-payroll.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const partners = await prisma.user.findMany({
    where: { role: "PARTNER" },
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      salaryStructure: { select: { id: true, monthlySalary: true } },
    },
  });

  console.log(`Found ${partners.length} partner(s):`);
  for (const p of partners) {
    const name = `${p.firstName} ${p.lastName || ""}`.trim();
    console.log(`  - ${name} (${p.employeeId}): salaryStructure=${p.salaryStructure ? `PKR ${p.salaryStructure.monthlySalary}` : "none"}`);
  }

  const partnerIds = partners.map((p) => p.id);
  if (partnerIds.length === 0) {
    console.log("\nNo partners found — nothing to clean up.");
    return;
  }

  // Count what we're about to delete BEFORE running, for the audit log.
  const [salaryStructureCount, payrollRecordCount, leaveBalanceCount] = await Promise.all([
    prisma.salaryStructure.count({ where: { userId: { in: partnerIds } } }),
    prisma.payrollRecord.count({ where: { userId: { in: partnerIds } } }),
    prisma.leaveBalance.count({ where: { userId: { in: partnerIds } } }),
  ]);

  console.log(`\nWill delete:`);
  console.log(`  ${salaryStructureCount} salaryStructure row(s)`);
  console.log(`  ${payrollRecordCount} payrollRecord row(s)`);
  console.log(`  ${leaveBalanceCount} leaveBalance row(s) (partners don't take leave)`);

  // Run the deletes in a single transaction so we don't half-clean state
  // if the process is killed midway.
  const [salDel, payDel, leaveDel] = await prisma.$transaction([
    prisma.salaryStructure.deleteMany({ where: { userId: { in: partnerIds } } }),
    prisma.payrollRecord.deleteMany({ where: { userId: { in: partnerIds } } }),
    prisma.leaveBalance.deleteMany({ where: { userId: { in: partnerIds } } }),
  ]);

  console.log(`\nDeleted:`);
  console.log(`  ${salDel.count} salaryStructure`);
  console.log(`  ${payDel.count} payrollRecord`);
  console.log(`  ${leaveDel.count} leaveBalance`);
  console.log(`\nDone — partner profiles now have no payroll footprint.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
