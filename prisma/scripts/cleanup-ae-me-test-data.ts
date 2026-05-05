/**
 * One-off cleanup: wipe all test data on AE-* and ME-* employees so the
 * AE / ME teams start tomorrow fresh. Targets exactly the records that
 * accumulated during last week's QA + partner self-tests.
 *
 * Scope:
 *   - Fine (auto-absence + manual)
 *   - Refund
 *   - ReviewBonus (submissions + approvals)
 *   - Attendance (including auto-marked ABSENT rows)
 *   - LeaveRequest
 *   - Incentive (test bonuses)
 *   - BonusEligibility (test 7-criteria rows)
 *   - DailyReport (end-of-day reports submitted via the form)
 *   - PayrollRecord (will auto-regenerate next time the page is viewed)
 *
 * Does NOT touch:
 *   - User rows themselves (employees stay)
 *   - SalaryStructure (employees keep their salaries)
 *   - LeaveBalance (yearly buckets — keep so the monthly reset still works)
 *   - EM team data (CEO's untouched)
 *   - PARTNER user rows (Awais/Mubeen/Zain themselves)
 *
 * Safe to re-run — only matches AE-* and ME-* prefixes.
 *
 * Usage:
 *   npx tsx prisma/scripts/cleanup-ae-me-test-data.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Resolve target users by employeeId prefix. Limited to EMPLOYEE role so
  // even if a partner accidentally has an AE-/ME- prefix one day they're
  // skipped here.
  const targets = await prisma.user.findMany({
    where: {
      role: "EMPLOYEE",
      OR: [
        { employeeId: { startsWith: "AE-" } },
        { employeeId: { startsWith: "ME-" } },
      ],
    },
    select: { id: true, employeeId: true, firstName: true, lastName: true },
    orderBy: { employeeId: "asc" },
  });

  if (targets.length === 0) {
    console.log("No AE-* or ME-* employees found. Nothing to clean.");
    return;
  }

  console.log(`Found ${targets.length} AE/ME employees:`);
  for (const u of targets) {
    console.log(`  ${u.employeeId}  ${u.firstName} ${u.lastName || ""}`.trim());
  }
  const ids = targets.map((u) => u.id);

  // Pre-count what we're about to delete.
  const [
    fineCount,
    refundCount,
    reviewBonusCount,
    attendanceCount,
    leaveRequestCount,
    incentiveCount,
    bonusEligibilityCount,
    dailyReportCount,
    payrollRecordCount,
  ] = await Promise.all([
    prisma.fine.count({ where: { userId: { in: ids } } }),
    prisma.refund.count({ where: { userId: { in: ids } } }),
    prisma.reviewBonus.count({ where: { userId: { in: ids } } }),
    prisma.attendance.count({ where: { userId: { in: ids } } }),
    prisma.leaveRequest.count({ where: { userId: { in: ids } } }),
    prisma.incentive.count({ where: { userId: { in: ids } } }),
    prisma.bonusEligibility.count({ where: { userId: { in: ids } } }),
    prisma.dailyReport.count({ where: { userId: { in: ids } } }),
    prisma.payrollRecord.count({ where: { userId: { in: ids } } }),
  ]);

  console.log(`\nWill delete:`);
  console.log(`  ${fineCount} fine(s)`);
  console.log(`  ${refundCount} refund(s)`);
  console.log(`  ${reviewBonusCount} review bonus submission(s)`);
  console.log(`  ${attendanceCount} attendance record(s)`);
  console.log(`  ${leaveRequestCount} leave request(s)`);
  console.log(`  ${incentiveCount} incentive(s)`);
  console.log(`  ${bonusEligibilityCount} bonus eligibility record(s)`);
  console.log(`  ${dailyReportCount} daily report submission(s)`);
  console.log(`  ${payrollRecordCount} payroll record(s)`);

  const total =
    fineCount + refundCount + reviewBonusCount + attendanceCount +
    leaveRequestCount + incentiveCount + bonusEligibilityCount +
    dailyReportCount + payrollRecordCount;
  if (total === 0) {
    console.log(`\nNothing to delete — already clean.`);
    return;
  }

  // Single transaction so we never end up partially cleaned. Order matters
  // only for FK chains; these tables don't reference each other so any order
  // works, but I'm doing leaf records first then PayrollRecord last as a
  // matter of habit.
  const [
    finesDel,
    refundsDel,
    reviewBonusDel,
    attendanceDel,
    leaveRequestDel,
    incentiveDel,
    bonusEligDel,
    dailyReportDel,
    payrollDel,
  ] = await prisma.$transaction([
    prisma.fine.deleteMany({ where: { userId: { in: ids } } }),
    prisma.refund.deleteMany({ where: { userId: { in: ids } } }),
    prisma.reviewBonus.deleteMany({ where: { userId: { in: ids } } }),
    prisma.attendance.deleteMany({ where: { userId: { in: ids } } }),
    prisma.leaveRequest.deleteMany({ where: { userId: { in: ids } } }),
    prisma.incentive.deleteMany({ where: { userId: { in: ids } } }),
    prisma.bonusEligibility.deleteMany({ where: { userId: { in: ids } } }),
    prisma.dailyReport.deleteMany({ where: { userId: { in: ids } } }),
    prisma.payrollRecord.deleteMany({ where: { userId: { in: ids } } }),
  ]);

  console.log(`\nDeleted:`);
  console.log(`  ${finesDel.count} fine(s)`);
  console.log(`  ${refundsDel.count} refund(s)`);
  console.log(`  ${reviewBonusDel.count} review bonus(es)`);
  console.log(`  ${attendanceDel.count} attendance row(s)`);
  console.log(`  ${leaveRequestDel.count} leave request(s)`);
  console.log(`  ${incentiveDel.count} incentive(s)`);
  console.log(`  ${bonusEligDel.count} bonus eligibility row(s)`);
  console.log(`  ${dailyReportDel.count} daily report(s)`);
  console.log(`  ${payrollDel.count} payroll record(s)`);
  console.log(`\nDone — AE / ME teams start fresh tomorrow.`);
  console.log(`Payroll records will auto-regenerate the first time the partner or CEO opens /payroll.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
