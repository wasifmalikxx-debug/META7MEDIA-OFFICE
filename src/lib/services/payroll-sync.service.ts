import { prisma } from "@/lib/prisma";

function roundMoney(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Syncs the payroll record for a user/month/year with current fines and incentives.
 * Call this whenever fines or incentives change to keep payroll up to date.
 */
export async function syncPayrollRecord(userId: string, month: number, year: number) {
  const payroll = await prisma.payrollRecord.findUnique({
    where: { userId_month_year: { userId, month, year } },
  });

  if (!payroll) return; // No payroll record yet — will be created on Generate
  if (payroll.status === "PAID") return; // Don't modify paid records

  // Recalculate fines and incentives from source of truth
  const [fines, incentives, salary] = await Promise.all([
    prisma.fine.findMany({ where: { userId, month, year } }),
    prisma.incentive.findMany({ where: { userId, month, year } }),
    prisma.salaryStructure.findUnique({ where: { userId } }),
  ]);

  const totalFines = fines.reduce((s, f) => s + f.amount, 0);

  let totalIncentives = 0;
  for (const inc of incentives) {
    if (inc.type === "PERCENTAGE" && inc.percentage) {
      totalIncentives += (salary?.monthlySalary || 0) * (inc.percentage / 100);
    } else {
      totalIncentives += inc.amount;
    }
  }

  // Recalculate deductions and net salary using roundMoney (matching payroll.service.ts)
  const dailyRate = roundMoney(payroll.monthlySalary / 30);
  const absentDeductions = roundMoney(payroll.absentDays * dailyRate);
  const halfDayDeductions = roundMoney(payroll.halfDays * dailyRate * 0.5);
  const totalDeductions = roundMoney(absentDeductions + halfDayDeductions + totalFines);
  const netSalary = Math.max(0, roundMoney(payroll.monthlySalary + totalIncentives - totalDeductions));

  await prisma.payrollRecord.update({
    where: { id: payroll.id },
    data: {
      totalFines: roundMoney(totalFines),
      totalIncentives: roundMoney(totalIncentives),
      totalDeductions,
      netSalary,
    },
  });
}
