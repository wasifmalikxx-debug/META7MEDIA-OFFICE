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
  let totalAbsentDays = 0;
  let halfDays = 0;
  const absentDates: Date[] = [];

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
        totalAbsentDays++;
        absentDates.push(att.date);
        break;
    }
  }

  // Get office settings for paid leave budget
  const settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
  });
  const paidLeavesPerMonth = settings?.paidLeavesPerMonth ?? 1;

  // ═══════════════════════════════════════════════════════════════
  // SINGLE SOURCE OF TRUTH: Normalize absent fines to match coverage
  // ═══════════════════════════════════════════════════════════════
  // Before computing payroll, make sure every absent day has exactly one
  // fine record and its amount reflects the current coverage state:
  //   - If budget covers it → amount = 0, reason = "Covered by paid leave"
  //   - If not covered     → amount = dailyRate, reason = "... deducted"
  //
  // This prevents stale fine records (e.g. a non-zero fine from an earlier
  // cron run that should now be covered after a leave was approved, or
  // vice versa). It's idempotent and self-healing — running it always
  // leaves the DB in the correct state.

  // System start for budget calculation
  const SYS_START = new Date(Date.UTC(2026, 3, 1));
  // Count half-day leaves (consume 0.5 each)
  const halfDayLeavesAllTime = await prisma.leaveRequest.count({
    where: {
      userId,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: SYS_START },
    },
  });

  // Compute total earned budget based on months active since system start
  const now = new Date(Date.now() + 5 * 60 * 60_000); // PKT
  const monthsActive = Math.max(
    1,
    (now.getUTCFullYear() - 2026) * 12 + (now.getUTCMonth() - 3) + 1
  );
  const totalEarned = monthsActive * paidLeavesPerMonth;

  // Sort absents chronologically so earlier ones get covered first
  const allUserAbsents = await prisma.attendance.findMany({
    where: { userId, status: "ABSENT", date: { gte: SYS_START } },
    select: { date: true },
    orderBy: { date: "asc" },
  });

  // Budget remaining as we walk through absents in order
  let budgetLeft = totalEarned - halfDayLeavesAllTime * 0.5;
  const admin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });

  for (const abs of allUserAbsents) {
    const dateStr = abs.date.toISOString().split("T")[0];
    const shouldCover = budgetLeft >= 1;
    if (shouldCover) budgetLeft -= 1;

    // Find existing fine for this absent
    const existingFine = await prisma.fine.findFirst({
      where: { userId, date: abs.date, type: "ABSENT_WITHOUT_LEAVE" },
    });

    if (shouldCover) {
      // Should be covered (amount = 0)
      const expectedReason = `Absent on ${dateStr} — Covered by paid leave`;
      if (!existingFine) {
        // No fine exists — create the covered one
        if (admin) {
          await prisma.fine.create({
            data: {
              userId,
              type: "ABSENT_WITHOUT_LEAVE",
              amount: 0,
              reason: expectedReason,
              date: abs.date,
              month: abs.date.getUTCMonth() + 1,
              year: abs.date.getUTCFullYear(),
              issuedById: admin.id,
            },
          });
        }
      } else if (existingFine.amount !== 0) {
        // Fine exists but wrong amount — update to covered
        await prisma.fine.update({
          where: { id: existingFine.id },
          data: { amount: 0, reason: expectedReason },
        });
      }
      // If existingFine.amount === 0, it's already correct
    } else {
      // Should be uncovered (deduct daily rate)
      const uncoveredAmount = Math.round(salary.monthlySalary / 30);
      const expectedReason = `Absent on ${dateStr} — PKR ${uncoveredAmount.toLocaleString()} (salary/30) deducted`;
      if (!existingFine) {
        if (admin) {
          await prisma.fine.create({
            data: {
              userId,
              type: "ABSENT_WITHOUT_LEAVE",
              amount: uncoveredAmount,
              reason: expectedReason,
              date: abs.date,
              month: abs.date.getUTCMonth() + 1,
              year: abs.date.getUTCFullYear(),
              issuedById: admin.id,
            },
          });
        }
      } else if (existingFine.amount !== uncoveredAmount) {
        await prisma.fine.update({
          where: { id: existingFine.id },
          data: { amount: uncoveredAmount, reason: expectedReason },
        });
      }
    }
  }

  // After normalization, count the covered fines for THIS month
  const monthCoveredAbsenceFines = await prisma.fine.findMany({
    where: {
      userId,
      amount: 0,
      type: "ABSENT_WITHOUT_LEAVE",
      reason: { contains: "Covered by paid leave" },
      date: { gte: startDate, lte: endDate },
    },
    select: { date: true },
  });
  const alreadyCoveredCount = monthCoveredAbsenceFines.length;

  // Orphan = absent in THIS month that still has a non-zero fine
  let orphanAbsents = Math.max(0, totalAbsentDays - alreadyCoveredCount);

  const { available: accumulatedAvailable } = await (
    await import("@/lib/services/leave-budget.service")
  ).getAccumulatedLeaveBudget(userId, paidLeavesPerMonth);

  let remainingBudget = accumulatedAvailable;

  // Half days consume 0.5 each from remaining budget
  const coveredHalfDays = Math.min(halfDays, Math.floor(remainingBudget / 0.5));
  const deductibleHalfDays = halfDays - coveredHalfDays;
  remainingBudget -= coveredHalfDays * 0.5;

  // At this point, orphan absents should be 0 because we normalized above.
  // But keep the logic for edge cases.
  let coveredOrphanAbsents = 0;
  let partialAbsentCoverage = 0;
  if (orphanAbsents > 0 && remainingBudget > 0) {
    if (remainingBudget >= orphanAbsents) {
      coveredOrphanAbsents = orphanAbsents;
      remainingBudget -= orphanAbsents;
    } else {
      coveredOrphanAbsents = Math.floor(remainingBudget);
      partialAbsentCoverage = remainingBudget - coveredOrphanAbsents;
      remainingBudget = 0;
    }
  }
  const uncoveredAbsentDays = orphanAbsents - coveredOrphanAbsents;

  // For the payroll record, absentDays = uncovered only
  let absentDays = uncoveredAbsentDays;
  const autoPaidLeaves = alreadyCoveredCount + coveredOrphanAbsents + partialAbsentCoverage + coveredHalfDays * 0.5;

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
  // EXCLUDE absence fines (type ABSENT_WITHOUT_LEAVE) because absent deductions
  // are already calculated separately above from attendance records.
  // Including them here would DOUBLE-DEDUCT for uncovered absences.
  const fines = await prisma.fine.findMany({
    where: { userId, month, year },
  });
  const totalFines = roundMoney(
    fines
      .filter((f) => f.type !== "ABSENT_WITHOUT_LEAVE")
      .reduce((sum, f) => sum + f.amount, 0)
  );

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

  // Check if record already exists and is PAID — never overwrite a paid record.
  // Once marked paid, the values are locked for audit trail.
  const existing = await prisma.payrollRecord.findUnique({
    where: { userId_month_year: { userId, month, year } },
  });
  if (existing && existing.status === "PAID") {
    return existing;
  }

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
      status: "DRAFT",
    },
  });
}

export async function generatePayrollForAll(
  month: number,
  year: number,
  generatedBy: string
) {
  // Only include employees who joined ON or BEFORE the last day of the payroll month
  const payrollMonthEnd = new Date(Date.UTC(year, month, 0)); // last day of month
  const employees = await prisma.user.findMany({
    where: {
      status: { in: ["HIRED", "PROBATION"] },
      role: { not: "SUPER_ADMIN" },
      salaryStructure: { isNot: null },
      joiningDate: { lte: payrollMonthEnd },
    },
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
