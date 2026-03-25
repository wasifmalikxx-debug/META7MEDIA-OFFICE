import { prisma } from "@/lib/prisma";

/**
 * Syncs the payroll record for a user/month/year with current fines and incentives.
 * Call this whenever fines or incentives change to keep payroll up to date.
 */
export async function syncPayrollRecord(userId: string, month: number, year: number) {
  const payroll = await prisma.payrollRecord.findUnique({
    where: { userId_month_year: { userId, month, year } },
  });

  if (!payroll) return; // No payroll record yet — will be created on Generate

  // Recalculate fines and incentives from source of truth
  const [fines, incentives] = await Promise.all([
    prisma.fine.findMany({ where: { userId, month, year } }),
    prisma.incentive.findMany({ where: { userId, month, year } }),
  ]);

  const totalFines = fines.reduce((s, f) => s + f.amount, 0);

  const salary = await prisma.salaryStructure.findUnique({ where: { userId } });
  let totalIncentives = 0;
  for (const inc of incentives) {
    if (inc.type === "PERCENTAGE" && inc.percentage) {
      totalIncentives += (salary?.monthlySalary || 0) * (inc.percentage / 100);
    } else {
      totalIncentives += inc.amount;
    }
  }

  // Recalculate deductions and net salary
  const dailyRate = Math.round(payroll.monthlySalary / 30);
  const absentDeductions = payroll.absentDays * dailyRate;
  const halfDayDeductions = payroll.halfDays * dailyRate * 0.5;
  const totalDeductions = Math.round(absentDeductions + halfDayDeductions + totalFines);
  const netSalary = Math.max(0, Math.round(payroll.monthlySalary + totalIncentives - totalDeductions));

  await prisma.payrollRecord.update({
    where: { id: payroll.id },
    data: {
      totalFines: Math.round(totalFines),
      totalIncentives: Math.round(totalIncentives),
      totalDeductions,
      netSalary,
    },
  });
}
