import { prisma } from "@/lib/prisma";
import { AttendanceStatus } from "@prisma/client";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getWorkingDaysInMonth(
  month: number,
  year: number
): Promise<number> {
  const settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
  });
  const weekendDays = (settings?.weekendDays || "0")
    .split(",")
    .map((d) => parseInt(d.trim()));

  const holidays = await prisma.holiday.findMany({
    where: { year, date: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) } },
  });
  const holidayDates = new Set(
    holidays.map((h) => h.date.toISOString().split("T")[0])
  );

  let workingDays = 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    const dateStr = date.toISOString().split("T")[0];
    if (!weekendDays.includes(dayOfWeek) && !holidayDates.has(dateStr)) {
      workingDays++;
    }
  }
  return workingDays;
}

export async function generatePayrollForEmployee(
  userId: string,
  month: number,
  year: number,
  generatedBy: string
) {
  const salary = await prisma.salaryStructure.findUnique({
    where: { userId },
  });
  if (!salary) throw new Error(`No salary structure for user ${userId}`);

  const workingDays = await getWorkingDaysInMonth(month, year);
  // Fixed 30-day formula: 30K salary = 1K/day deduction
  const dailyRate = roundMoney(salary.monthlySalary / 30);

  // Get attendance records for the month
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const attendances = await prisma.attendance.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: endDate },
    },
  });

  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let halfDays = 0;

  for (const att of attendances) {
    switch (att.status) {
      case AttendanceStatus.PRESENT:
        presentDays++;
        break;
      case AttendanceStatus.LATE:
        presentDays++;
        lateDays++;
        break;
      case AttendanceStatus.HALF_DAY:
        halfDays++;
        break;
      case AttendanceStatus.ABSENT:
        absentDays++;
        break;
    }
  }

  // Paid leave budget: 1.0 day per month
  // Half day = 0.5 from budget, absent = uses remaining budget, then deducted
  const settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
  });
  const paidLeaveBudget = settings?.paidLeavesPerMonth ?? 1; // 1.0 day

  let remainingBudget = paidLeaveBudget;

  // Half days consume 0.5 each from budget
  const coveredHalfDays = Math.min(halfDays, Math.floor(remainingBudget / 0.5));
  const deductibleHalfDays = halfDays - coveredHalfDays;
  remainingBudget -= coveredHalfDays * 0.5;

  // Absences consume remaining budget (partial coverage possible)
  // e.g., if 0.5 budget left and 1 absent → 0.5 covered, 0.5 deducted
  let coveredAbsentDays = 0;
  let partialAbsentCoverage = 0;
  if (absentDays > 0 && remainingBudget > 0) {
    if (remainingBudget >= absentDays) {
      coveredAbsentDays = absentDays;
      remainingBudget -= absentDays;
    } else {
      // Partial: e.g., 0.5 budget covers 0.5 of first absent day
      coveredAbsentDays = Math.floor(remainingBudget);
      partialAbsentCoverage = remainingBudget - coveredAbsentDays; // e.g., 0.5
      remainingBudget = 0;
    }
  }
  const uncoveredAbsentDays = absentDays - coveredAbsentDays;
  absentDays = uncoveredAbsentDays;

  const autoPaidLeaves = coveredAbsentDays + partialAbsentCoverage + coveredHalfDays * 0.5;

  // Get approved leaves for the month (manual leave requests)
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      userId,
      status: "APPROVED",
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  });

  let paidLeaveDays = autoPaidLeaves;
  let unpaidLeaveDays = 0;
  for (const leave of leaves) {
    const leaveStart = new Date(
      Math.max(leave.startDate.getTime(), startDate.getTime())
    );
    const leaveEnd = new Date(
      Math.min(leave.endDate.getTime(), endDate.getTime())
    );
    const days =
      Math.floor(
        (leaveEnd.getTime() - leaveStart.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

    if (leave.leaveType === "UNPAID") {
      unpaidLeaveDays += days;
    } else {
      paidLeaveDays += leave.leaveType === "HALF_DAY" ? 0.5 : days;
    }
  }

  // Get fines and incentives for the month
  const fines = await prisma.fine.findMany({
    where: { userId, month, year },
  });
  const totalFines = roundMoney(fines.reduce((sum, f) => sum + f.amount, 0));

  const incentives = await prisma.incentive.findMany({
    where: { userId, month, year },
  });
  let totalIncentives = 0;
  for (const inc of incentives) {
    if (inc.type === "PERCENTAGE" && inc.percentage) {
      totalIncentives += roundMoney(
        salary.monthlySalary * (inc.percentage / 100)
      );
    } else {
      totalIncentives += inc.amount;
    }
  }
  totalIncentives = roundMoney(totalIncentives);

  // Calculate salary
  // Gross = monthly salary
  // Deductions = uncovered absences + uncovered half days + partial absent + fines + tax
  const halfDayDeductions = roundMoney(deductibleHalfDays * dailyRate * 0.5);
  const leaveDeductions = roundMoney(unpaidLeaveDays * dailyRate);
  // Uncovered absents deducted fully, partial coverage deducts the uncovered portion
  const absentDeductions = roundMoney(
    absentDays * dailyRate + (partialAbsentCoverage > 0 ? (1 - partialAbsentCoverage) * dailyRate : 0)
  );
  const earnedSalary = roundMoney(salary.monthlySalary);
  const taxDeduction = roundMoney(earnedSalary * (salary.taxPercent / 100));
  const fixedDeductions = roundMoney(
    salary.socialSecurity + salary.otherDeductions
  );
  const totalDeductions = roundMoney(
    halfDayDeductions + leaveDeductions + absentDeductions + totalFines + taxDeduction + fixedDeductions
  );

  const netSalary = roundMoney(
    Math.max(0, salary.monthlySalary + totalIncentives - totalDeductions)
  );

  // Check if record already exists and is PAID — don't overwrite paid status
  const existing = await prisma.payrollRecord.findUnique({
    where: { userId_month_year: { userId, month, year } },
  });

  const payrollData = {
    monthlySalary: salary.monthlySalary,
    workingDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    lateDays,
    absentDays,
    halfDays,
    dailyRate,
    earnedSalary,
    totalIncentives,
    totalFines,
    totalDeductions,
    netSalary,
    generatedBy,
  };

  return prisma.payrollRecord.upsert({
    where: { userId_month_year: { userId, month, year } },
    create: {
      userId,
      month,
      year,
      ...payrollData,
      status: "DRAFT",
    },
    update: {
      ...payrollData,
      // Preserve PAID status — only set DRAFT if not already paid
      ...(existing?.status !== "PAID" ? { status: "DRAFT" } : {}),
    },
  });
}

export async function generatePayrollForAll(
  month: number,
  year: number,
  generatedBy: string
) {
  const employees = await prisma.user.findMany({
    where: { status: { in: ["HIRED", "PROBATION"] }, role: { not: "SUPER_ADMIN" }, salaryStructure: { isNot: null } },
    select: { id: true },
  });

  const results = [];
  for (const emp of employees) {
    try {
      const record = await generatePayrollForEmployee(
        emp.id,
        month,
        year,
        generatedBy
      );
      results.push({ userId: emp.id, success: true, record });
    } catch (error) {
      results.push({
        userId: emp.id,
        success: false,
        error: (error as Error).message,
      });
    }
  }
  return results;
}
