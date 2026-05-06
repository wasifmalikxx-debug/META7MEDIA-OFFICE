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

  // Same TZ caveat as in generatePayrollForEmployee — use UTC throughout
  // so the working-day count doesn't shift by a day on non-UTC hosts.
  const holidays = await prisma.holiday.findMany({
    where: {
      year,
      date: {
        gte: new Date(Date.UTC(year, month - 1, 1)),
        lt: new Date(Date.UTC(year, month, 1)),
      },
    },
  });
  const holidayDates = new Set(
    holidays.map((h) => h.date.toISOString().split("T")[0])
  );

  let workingDays = 0;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = date.getUTCDay();
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

  // Need the employee's joining date to prorate salary for mid-month hires.
  const employee = await prisma.user.findUnique({
    where: { id: userId },
    select: { joiningDate: true },
  });

  const workingDays = await getWorkingDaysInMonth(month, year);
  // Fixed 30-day formula: 30K salary = 1K/day deduction
  const dailyRate = roundMoney(salary.monthlySalary / 30);

  // Get attendance records for the month.
  // IMPORTANT: use Date.UTC so the month bounds always anchor to UTC
  // midnight regardless of the host machine's timezone. `new Date(y, m, d)`
  // interprets local time, which on a PKT-timezone machine resolves to
  // 19:00 UTC the previous day — that breaks the proration branch below
  // for any employee whose joiningDate is stored at UTC midnight on the
  // 1st (the proration thinks they joined a day late and pays 29/30
  // days). Bug bit Apr 1 hires (EM-1 Alishba, SMM-10 Shoaib) when the
  // multi-office migration scripts ran from local on May 4.
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0));
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
  // SINGLE SOURCE OF TRUTH: Normalize absent fines per month
  // ═══════════════════════════════════════════════════════════════
  // Office rule (set 2026-05-04): each month, the FIRST absent is auto-
  // covered (amount=0). All subsequent absents in the same month deduct
  // dailyRate. This per-month allowance is independent of the half-day-
  // leave entitlement budget shown on the dashboard.
  //
  // We walk this user's absent attendance records grouped by month,
  // earliest-first, so the first absent of each month gets the cover and
  // later ones get the deduction. Idempotent: re-running always produces
  // the same fine state for the same attendance state.

  const SYS_START = new Date(Date.UTC(2026, 3, 1));
  const allUserAbsents = await prisma.attendance.findMany({
    where: { userId, status: "ABSENT", date: { gte: SYS_START } },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  const admin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });

  // Track whether each month's auto-cover allowance has been consumed.
  const monthlyCoverUsed: Record<string, boolean> = {};
  for (const att of allUserAbsents) {
    const monthKey = `${att.date.getUTCFullYear()}-${att.date.getUTCMonth()}`;
    const dateStr = att.date.toISOString().split("T")[0];

    const covered = !monthlyCoverUsed[monthKey];
    monthlyCoverUsed[monthKey] = true;

    const expectedAmount = covered ? 0 : dailyRate;
    const expectedReason = covered
      ? `Absent on ${dateStr} — Covered by paid leave (1.0 day used)`
      : `Absent on ${dateStr} — PKR ${expectedAmount.toLocaleString()} (salary/30) deducted`;

    const existingFine = await prisma.fine.findFirst({
      where: { userId, date: att.date, type: "ABSENT_WITHOUT_LEAVE" },
    });

    if (!existingFine) {
      if (admin) {
        await prisma.fine.create({
          data: {
            userId,
            type: "ABSENT_WITHOUT_LEAVE",
            amount: expectedAmount,
            reason: expectedReason,
            date: att.date,
            month: att.date.getUTCMonth() + 1,
            year: att.date.getUTCFullYear(),
            issuedById: admin.id,
          },
        });
      }
    } else if (existingFine.amount !== expectedAmount || existingFine.reason !== expectedReason) {
      await prisma.fine.update({
        where: { id: existingFine.id },
        data: { amount: expectedAmount, reason: expectedReason },
      });
    }
  }

  // ── Read the normalized fines for THIS month to compute payroll totals ──
  // Single source of truth: the loop above set every absent fine's amount and
  // reason correctly. Parse the reason to extract how much budget each one
  // consumed, and use amount directly for deduction.
  const monthAbsentFines = await prisma.fine.findMany({
    where: {
      userId,
      type: "ABSENT_WITHOUT_LEAVE",
      date: { gte: startDate, lte: endDate },
    },
    select: { amount: true, reason: true },
  });

  let absentPaidLeaveDays = 0; // budget days consumed by absents this month
  let absentFineTotal = 0;     // PKR deducted for uncovered/partial portions
  for (const f of monthAbsentFines) {
    absentFineTotal += f.amount || 0;
    const reason = f.reason || "";
    const partial = reason.match(/Partially covered by paid leave \((\d+(?:\.\d+)?) day used\)/i);
    if (partial) {
      absentPaidLeaveDays += parseFloat(partial[1]);
    } else if (/Covered by paid leave/i.test(reason)) {
      absentPaidLeaveDays += 1;
    }
  }

  // For the payroll record:
  //   - absentDays counts days with ANY uncovered portion (purely informational)
  //   - deductibleHalfDays is computed below from attendance.HALF_DAY days that
  //     were NOT backed by a half-day leave (budget already consumed via leave)
  const fullyUncoveredAbsents = monthAbsentFines.filter(
    (f) => f.amount > 0 && !/Partially covered/i.test(f.reason || "")
  ).length;
  const partiallyCoveredAbsents = monthAbsentFines.filter(
    (f) => /Partially covered/i.test(f.reason || "")
  ).length;
  let absentDays = fullyUncoveredAbsents + partiallyCoveredAbsents;

  // Half days: attendance.HALF_DAY count (line 80) is the raw count of days
  // marked HALF_DAY. Each corresponds to either a half-day leave request
  // (budget already consumed via leave) or an orphan half-day (no leave).
  // Budget for orphan half-days has ALREADY been consumed in the walk above
  // if there was one — but the walk only processed half-day LEAVES. So orphan
  // half-days (HALF_DAY status without a matching leave) are effectively
  // half-day absences and should deduct 0.5 × dailyRate each.
  const halfDayLeavesThisMonth = await prisma.leaveRequest.count({
    where: {
      userId,
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: startDate, lte: endDate },
    },
  });
  // attendance.HALF_DAY that don't have a matching leave this month
  const orphanHalfDays = Math.max(0, halfDays - halfDayLeavesThisMonth);
  const deductibleHalfDays = orphanHalfDays;

  const autoPaidLeaves = absentPaidLeaveDays + halfDayLeavesThisMonth * 0.5;

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
  // Gross = prorated monthly salary based on joining date
  // Deductions = uncovered absences (from fine amounts) + uncovered half days + fines + tax
  const halfDayDeductions = roundMoney(deductibleHalfDays * dailyRate * 0.5);
  const leaveDeductions = roundMoney(unpaidLeaveDays * dailyRate);
  // Absent deductions come directly from the normalized fine amounts set above.
  // This handles full (dailyRate), partial (dailyRate × uncoveredFraction), and
  // covered (0) in one place — no double-counting possible.
  const absentDeductions = roundMoney(absentFineTotal);

  // PRORATION: an employee who joined mid-month earns salary only from their
  // joining date forward, not the full month. Everyone whose joining date is
  // on or before the month start earns their full monthlySalary (no change
  // from previous behaviour).
  //
  // The 30-day divisor matches `dailyRate = monthlySalary / 30` used for
  // per-day deductions throughout this file. A 31-day month pays the same
  // as a 30-day month for full-month employees (no one is overpaid in
  // long months, no one is underpaid in short months like February).
  let daysPayable = 30;
  if (employee?.joiningDate && employee.joiningDate.getTime() > startDate.getTime()) {
    const joinMs = employee.joiningDate.getTime();
    const endMs = endDate.getTime();
    // daysApplicable = (endDate - joiningDate) / 1-day + 1, inclusive of both ends
    const raw = Math.floor((endMs - joinMs) / (24 * 60 * 60 * 1000)) + 1;
    daysPayable = Math.min(30, Math.max(0, raw));
  }
  const earnedSalary = roundMoney(dailyRate * daysPayable);
  const taxDeduction = roundMoney(earnedSalary * (salary.taxPercent / 100));
  const fixedDeductions = roundMoney(
    salary.socialSecurity + salary.otherDeductions
  );
  const totalDeductions = roundMoney(
    halfDayDeductions + leaveDeductions + absentDeductions + totalFines + taxDeduction + fixedDeductions
  );

  const netSalary = roundMoney(
    Math.max(0, earnedSalary + totalIncentives - totalDeductions)
  );

  // Check if record already exists and is immutable.
  // Immutable means either:
  //   - status === PAID (marked paid, locked for audit trail)
  //   - lockedAt set (month snapshot created by admin)
  // In both cases, return the existing record unchanged.
  const existing = await prisma.payrollRecord.findUnique({
    where: { userId_month_year: { userId, month, year } },
  });
  if (existing && (existing.status === "PAID" || existing.lockedAt)) {
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
  // Only include employees who joined ON or BEFORE the last day of the payroll month.
  // Skip SUPER_ADMIN (CEO is not on payroll) and PARTNER (Awais/Mubeen/Zain manage
  // teams but aren't employees) — they should never have payroll records generated.
  const payrollMonthEnd = new Date(Date.UTC(year, month, 0)); // last day of month
  const employees = await prisma.user.findMany({
    where: {
      status: { in: ["HIRED", "PROBATION"] },
      role: { notIn: ["SUPER_ADMIN", "PARTNER"] },
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
