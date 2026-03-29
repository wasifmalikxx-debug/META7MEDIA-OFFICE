import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { todayPKT, pktMonth, pktYear, nowPKT, startOfMonthPKT } from "@/lib/pkt";

/**
 * Daily cron — runs at 7:33 PM PKT
 * Marks employees who didn't check in today as ABSENT
 * Creates an absent fine (salary/30) for each absent employee
 * Respects paid leave budget (configurable per month)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && process.env.NODE_ENV === "production") {
    return error("Unauthorized", 401);
  }

  try {
    const today = todayPKT();
    const month = pktMonth();
    const year = pktYear();
    const dayOfWeek = nowPKT().getUTCDay();
    const monthStart = startOfMonthPKT();

    // Check weekend
    const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
    const weekendDays = (settings?.weekendDays || "0").split(",").map((d: string) => parseInt(d.trim()));
    if (weekendDays.includes(dayOfWeek)) {
      return json({ message: "Weekend — skipped" });
    }

    // Check holiday
    const holiday = await prisma.holiday.findFirst({ where: { date: today } });
    if (holiday) {
      return json({ message: `Holiday (${holiday.name}) — skipped` });
    }

    // BATCH LOAD: Get all data upfront instead of querying per employee
    const [employees, todayAttendances, todayLeaves, monthAttendances, monthFines, admin] = await Promise.all([
      prisma.user.findMany({
        where: { role: { not: "SUPER_ADMIN" }, status: { in: ["HIRED", "PROBATION"] } },
        select: { id: true, firstName: true, lastName: true, employeeId: true, phone: true, salaryStructure: { select: { monthlySalary: true } } },
      }),
      prisma.attendance.findMany({
        where: { date: today },
        select: { userId: true, status: true },
      }),
      prisma.leaveRequest.findMany({
        where: { startDate: { lte: today }, endDate: { gte: today }, status: "APPROVED", leaveType: "HALF_DAY" },
        select: { userId: true },
      }),
      prisma.attendance.findMany({
        where: { date: { gte: monthStart, lte: today }, status: { in: ["ABSENT", "HALF_DAY"] } },
        select: { userId: true, status: true },
      }),
      prisma.fine.findMany({
        where: { month, year, reason: { contains: "Covered by paid leave" } },
        select: { userId: true },
      }),
      prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } }),
    ]);

    // Build lookup maps
    const attendanceMap = new Set(todayAttendances.map((a) => a.userId));
    const halfDayLeaveSet = new Set(todayLeaves.map((l) => l.userId));
    const paidLeaveBudget = settings?.paidLeavesPerMonth ?? 1;

    // Count month absents/half-days per user
    const monthAbsentCount: Record<string, number> = {};
    const monthHalfDayCount: Record<string, number> = {};
    for (const a of monthAttendances) {
      if (a.status === "ABSENT") monthAbsentCount[a.userId] = (monthAbsentCount[a.userId] || 0) + 1;
      if (a.status === "HALF_DAY") monthHalfDayCount[a.userId] = (monthHalfDayCount[a.userId] || 0) + 1;
    }
    // Count paid leave fines per user
    const paidLeaveUsed: Record<string, number> = {};
    for (const f of monthFines) {
      paidLeaveUsed[f.userId] = (paidLeaveUsed[f.userId] || 0) + 1;
    }

    const results: any[] = [];
    const dateStr = today.toISOString().split("T")[0];

    for (const emp of employees) {
      // Already has attendance record — skip
      if (attendanceMap.has(emp.id)) {
        continue;
      }

      // Has approved half-day leave — mark as half day
      if (halfDayLeaveSet.has(emp.id)) {
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

      const monthlySalary = emp.salaryStructure?.monthlySalary || 0;
      const dailyRate = Math.round(monthlySalary / 30);

      if (dailyRate > 0) {
        const usedBudget = (monthHalfDayCount[emp.id] || 0) * 0.5;
        const remainingBudget = paidLeaveBudget - usedBudget;
        const coveredCount = paidLeaveUsed[emp.id] || 0;
        const totalAbsents = (monthAbsentCount[emp.id] || 0); // doesn't include current (not in DB yet during batch load)

        let fineAmount = dailyRate;
        let fineReason = `Absent on ${dateStr} — PKR ${dailyRate.toLocaleString()} (salary/30) deducted`;
        let isCoveredByPaidLeave = false;

        if (remainingBudget > 0 && totalAbsents - coveredCount < remainingBudget) {
          fineAmount = 0;
          fineReason = `Absent on ${dateStr} — Covered by paid leave (${coveredCount + 1}/${paidLeaveBudget} used)`;
          isCoveredByPaidLeave = true;
        }

        await prisma.fine.create({
          data: {
            userId: emp.id,
            type: "ABSENT_WITHOUT_LEAVE",
            amount: fineAmount,
            reason: fineReason,
            date: today,
            month,
            year,
            issuedById: admin?.id || emp.id,
          },
        });

        // WhatsApp notification (only if actual deduction)
        if (fineAmount > 0 && emp.phone) {
          try {
            const { sendAbsentTemplate } = await import("@/lib/services/whatsapp.service");
            const empName = `${emp.firstName} ${emp.lastName || ""}`.trim();
            sendAbsentTemplate(emp.phone, empName, fineAmount).catch((err: any) =>
              console.warn(`WhatsApp absent failed for ${emp.employeeId}:`, err.message)
            );
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

    return json({ message: `Processed ${results.length} employees`, date: today.toISOString(), results });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
