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
  const dailyRate = roundMoney(salary.monthlySalary / workingDays);

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

  // Auto-apply paid leaves: first N absences are treated as paid leave
  const settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
  });
  const paidLeaveAllowance = settings?.paidLeavesPerMonth ?? 1;

  // Auto-convert first absence(s) to paid leave
  const autoPaidLeaves = Math.min(absentDays, paidLeaveAllowance);
  absentDays = absentDays - autoPaidLeaves;

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

  // Calculate
  const effectivePresentDays = presentDays + halfDays * 0.5 + paidLeaveDays;
  const earnedSalary = roundMoney(effectivePresentDays * dailyRate);

  const leaveDeductions = roundMoney(unpaidLeaveDays * dailyRate);
  const absentDeductions = roundMoney(absentDays * dailyRate);
  const taxDeduction = roundMoney(earnedSalary * (salary.taxPercent / 100));
  const fixedDeductions = roundMoney(
    salary.socialSecurity + salary.otherDeductions
  );
  const totalDeductions = roundMoney(
    leaveDeductions + absentDeductions + totalFines + taxDeduction + fixedDeductions
  );

  const netSalary = roundMoney(
    Math.max(0, earnedSalary + totalIncentives - totalDeductions)
  );

  // Upsert payroll record
  return prisma.payrollRecord.upsert({
    where: { userId_month_year: { userId, month, year } },
    create: {
      userId,
      month,
      year,
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
      status: "DRAFT",
    },
    update: {
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
      status: "DRAFT",
    },
  });
}

export async function generatePayrollForAll(
  month: number,
  year: number,
  generatedBy: string
) {
  const employees = await prisma.user.findMany({
    where: { status: { in: ["HIRED", "PROBATION"] }, salaryStructure: { isNot: null } },
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
