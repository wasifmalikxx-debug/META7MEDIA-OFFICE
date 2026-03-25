import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

/**
 * Daily cron — runs at 7:30 PM
 * Marks employees who didn't check in today as ABSENT
 * Creates an absent fine (salary/30) for each absent employee
 * Respects paid leave budget (1 per month)
 */
export async function GET(request: NextRequest) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && process.env.NODE_ENV === "production") {
    return error("Unauthorized", 401);
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const dayOfWeek = today.getDay();

    // Check if today is a weekend
    const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
    const weekendDays = (settings?.weekendDays || "0").split(",").map((d) => parseInt(d.trim()));
    if (weekendDays.includes(dayOfWeek)) {
      return json({ message: "Weekend — skipped", date: today.toISOString() });
    }

    // Check if today is a holiday
    const holiday = await prisma.holiday.findFirst({
      where: { date: today },
    });
    if (holiday) {
      return json({ message: `Holiday (${holiday.name}) — skipped`, date: today.toISOString() });
    }

    // Get all active employees (not admin)
    const employees = await prisma.user.findMany({
      where: {
        role: { not: "SUPER_ADMIN" },
        status: { in: ["HIRED", "PROBATION"] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        phone: true,
        salaryStructure: { select: { monthlySalary: true } },
      },
    });

    const results: any[] = [];
    const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });

    for (const emp of employees) {
      // Check if they already have an attendance record for today
      const existing = await prisma.attendance.findUnique({
        where: { userId_date: { userId: emp.id, date: today } },
      });

      if (existing) {
        // Already checked in or already marked — skip
        results.push({ employeeId: emp.employeeId, status: existing.status, action: "already_recorded" });
        continue;
      }

      // Check if they have an approved half-day leave for today
      const halfDayLeave = await prisma.leaveRequest.findFirst({
        where: {
          userId: emp.id,
          startDate: { lte: today },
          endDate: { gte: today },
          status: "APPROVED",
          leaveType: "HALF_DAY",
        },
      });

      if (halfDayLeave) {
        // Half day leave — mark as half day, don't mark absent
        await prisma.attendance.create({
          data: { userId: emp.id, date: today, status: "HALF_DAY" },
        });
        results.push({ employeeId: emp.employeeId, action: "half_day_leave" });
        continue;
      }

      // No check-in, no leave — mark as ABSENT
      await prisma.attendance.create({
        data: { userId: emp.id, date: today, status: "ABSENT" },
      });

      // Calculate absent fine: salary / 30
      const monthlySalary = emp.salaryStructure?.monthlySalary || 0;
      const dailyRate = Math.round(monthlySalary / 30);

      if (dailyRate > 0) {
        // Check paid leave budget: 1 day per month
        // Count how much paid leave budget has been used this month
        const monthAbsents = await prisma.attendance.findMany({
          where: { userId: emp.id, date: { gte: new Date(year, month - 1, 1), lte: today }, status: "ABSENT" },
        });
        const monthHalfDays = await prisma.attendance.findMany({
          where: { userId: emp.id, date: { gte: new Date(year, month - 1, 1), lte: today }, status: "HALF_DAY" },
        });

        const paidLeaveBudget = settings?.paidLeavesPerMonth ?? 1;
        const usedBudget = (monthHalfDays.length * 0.5); // half days consume 0.5 each
        const remainingBudget = paidLeaveBudget - usedBudget;

        let fineAmount = dailyRate;
        let fineReason = `Absent on ${today.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })} — PKR ${dailyRate.toLocaleString()} (salary/30) deducted`;
        let isCoveredByPaidLeave = false;

        if (remainingBudget >= 1) {
          // This absence is covered by paid leave — but only for the FIRST uncovered absent
          // Count previous absents that already used budget
          const previousAbsentFines = await prisma.fine.findMany({
            where: { userId: emp.id, month, year, reason: { contains: "Covered by paid leave" } },
          });
          const previousUncoveredAbsents = monthAbsents.length - 1 - previousAbsentFines.length; // -1 because current one is included

          if (previousUncoveredAbsents < Math.floor(remainingBudget)) {
            // Covered by paid leave
            fineAmount = 0;
            fineReason = `Absent on ${today.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })} — Covered by paid leave (${paidLeaveBudget - remainingBudget + 1}/${paidLeaveBudget} used)`;
            isCoveredByPaidLeave = true;
          }
        }

        // Create fine record (even if 0 for transparency)
        await prisma.fine.create({
          data: {
            userId: emp.id,
            type: "ABSENT_WITHOUT_LEAVE",
            amount: fineAmount,
            reason: fineReason,
            isAutoGenerated: true,
            month,
            year,
            issuedById: admin?.id || emp.id,
          },
        });

        // WhatsApp notification (only if actual deduction)
        if (fineAmount > 0) {
          try {
            const { notifyEmployee, manualFineMsg } = await import("@/lib/services/whatsapp.service");
            const empName = `${emp.firstName} ${emp.lastName || ""}`.trim();
            notifyEmployee(emp.id, manualFineMsg(empName, fineAmount, fineReason)).catch(() => {});
          } catch {}
        }

        results.push({
          employeeId: emp.employeeId,
          name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
          action: "marked_absent",
          fine: fineAmount,
          coveredByPaidLeave: isCoveredByPaidLeave,
        });
      }
    }

    return json({
      message: `Processed ${results.length} employees`,
      date: today.toISOString(),
      results,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
