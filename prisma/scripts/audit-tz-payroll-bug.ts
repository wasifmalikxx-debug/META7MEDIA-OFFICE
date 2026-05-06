/**
 * Audit which past-month payroll records are affected by the TZ proration
 * bug in payroll.service.ts. The bug: `new Date(year, month-1, 1)` resolves
 * to local time, not UTC. On a non-UTC machine (PKT) the start-of-month
 * landed at March 31 19:00 UTC for April, making any employee whose
 * joiningDate is stored at UTC-midnight-of-month-start trigger the
 * pro-ration branch and earn 29 days instead of 30.
 *
 * Symptom: payroll.earnedSalary < salaryStructure.monthlySalary even though
 * the employee was on payroll the whole month.
 *
 * Read-only — does not modify any records.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const records = await prisma.payrollRecord.findMany({
    include: {
      user: {
        select: {
          employeeId: true,
          firstName: true,
          lastName: true,
          joiningDate: true,
          status: true,
          salaryStructure: { select: { monthlySalary: true } },
        },
      },
    },
  });

  const affected: any[] = [];
  for (const r of records) {
    const sal = r.user.salaryStructure?.monthlySalary;
    if (!sal) continue;
    if (!r.user.joiningDate) continue;
    // Only look at records where the employee joined on the 1st of any month
    // at UTC midnight (the trigger condition for the bug).
    const j = r.user.joiningDate;
    if (j.getUTCDate() !== 1) continue;
    if (j.getUTCHours() !== 0 || j.getUTCMinutes() !== 0) continue;

    // Check if the record's earnedSalary suggests 29-day proration.
    // Expected for full month: earnedSalary ≈ monthlySalary
    // Buggy: earnedSalary ≈ monthlySalary × 29/30
    const expected29 = Math.round((sal * 29) / 30 * 100) / 100;
    const expected30 = sal;
    const actualEarned = (r as any).earnedSalary;
    if (typeof actualEarned !== "number") continue;

    const diff29 = Math.abs(actualEarned - expected29);
    const diff30 = Math.abs(actualEarned - expected30);
    // Flag if it matches the 29-day pattern much more closely than 30
    const looksBuggy = diff29 < 10 && diff30 > 10 && r.month === j.getUTCMonth() + 1 && r.year === j.getUTCFullYear();
    if (looksBuggy) {
      affected.push({
        employeeId: r.user.employeeId,
        name: `${r.user.firstName} ${r.user.lastName || ""}`.trim(),
        joiningDate: j.toISOString().slice(0, 10),
        month: r.month,
        year: r.year,
        monthlySalary: sal,
        earnedSalary: actualEarned,
        underpaidBy: Math.round((expected30 - actualEarned) * 100) / 100,
        netSalary: r.netSalary,
        status: r.status,
      });
    }
  }

  console.log(`Found ${affected.length} affected payroll record(s):\n`);
  for (const a of affected) {
    console.log(
      `  ${a.employeeId}  ${a.name}  joined ${a.joiningDate}  ${a.month}/${a.year}  earned=${a.earnedSalary}  (should be ${a.monthlySalary}, underpaid by Rs${a.underpaidBy})  status=${a.status}`,
    );
  }
}

main().then(() => prisma.$disconnect()).catch((e) => {
  console.error(e);
  return prisma.$disconnect().finally(() => process.exit(1));
});
