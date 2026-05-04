import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { todayPKT, pktMonth, pktYear, nowPKT } from "@/lib/pkt";

/**
 * Daily cron — runs after work hours each day.
 * Marks employees who didn't check in today as ABSENT and writes the
 * appropriate fine (covered or deducted, per the per-month allowance rule).
 *
 * MULTI-OFFICE behavior (Phase 7):
 *   - Loops every Office row.
 *   - Per-office settings drive the weekend/holiday checks (each office can
 *     have its own working days and its own holidays).
 *   - PARTNER role is excluded from the employee scan — partners aren't
 *     paid employees, they have no salary, no attendance.
 *   - The fine "issuedById" is always the CEO (SUPER_ADMIN), regardless of
 *     office, per Wasif's rule that he controls all WhatsApp / fine routing.
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
    const dateStr = today.toISOString().split("T")[0];

    const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
    const offices = await prisma.office.findMany({
      include: { settings: true },
      orderBy: { isPrimary: "desc" },
    });

    const perOfficeResults: any[] = [];

    for (const office of offices) {
      const settings = office.settings;
      const weekendDays = (settings?.weekendDays || "0").split(",").map((d) => parseInt(d.trim()));
      if (weekendDays.includes(dayOfWeek)) {
        perOfficeResults.push({ office: office.slug, skipped: "weekend" });
        continue;
      }

      // Office-specific holiday OR global (officeId=null)
      const holiday = await prisma.holiday.findFirst({
        where: {
          date: today,
          OR: [{ officeId: office.id }, { officeId: null }],
        },
      });
      if (holiday) {
        perOfficeResults.push({ office: office.slug, skipped: `holiday: ${holiday.name}` });
        continue;
      }

      // Employees in this office (excludes CEO + partners)
      const employees = await prisma.user.findMany({
        where: {
          officeId: office.id,
          role: { in: ["EMPLOYEE", "MANAGER"] },
          status: { in: ["HIRED", "PROBATION"] },
          joiningDate: { lte: today },
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

      const todayAttendances = await prisma.attendance.findMany({
        where: { date: today, userId: { in: employees.map((e) => e.id) } },
        select: { userId: true },
      });
      const todayLeaves = await prisma.leaveRequest.findMany({
        where: {
          userId: { in: employees.map((e) => e.id) },
          startDate: { lte: today },
          endDate: { gte: today },
          status: "APPROVED",
          leaveType: "HALF_DAY",
        },
        select: { userId: true },
      });

      const attendanceMap = new Set(todayAttendances.map((a) => a.userId));
      const halfDayLeaveSet = new Set(todayLeaves.map((l) => l.userId));

      const officeResults: any[] = [];

      for (const emp of employees) {
        if (attendanceMap.has(emp.id)) continue;

        if (halfDayLeaveSet.has(emp.id)) {
          await prisma.attendance.create({
            data: { userId: emp.id, date: today, status: "HALF_DAY" },
          });
          officeResults.push({ employeeId: emp.employeeId, action: "half_day_leave" });
          continue;
        }

        await prisma.attendance.create({
          data: { userId: emp.id, date: today, status: "ABSENT" },
        });

        const monthlySalary = emp.salaryStructure?.monthlySalary || 0;
        const dailyRate = Math.round(monthlySalary / 30);

        if (dailyRate > 0) {
          const { hasMonthlyAbsenceCoverageBeenUsed } = await import("@/lib/services/leave-budget.service");
          const allowanceUsed = await hasMonthlyAbsenceCoverageBeenUsed(emp.id, month, year);
          const covered = !allowanceUsed;
          const fineAmount = covered ? 0 : dailyRate;
          const fineReason = covered
            ? `Absent on ${dateStr} — Covered by paid leave (1.0 day used)`
            : `Absent on ${dateStr} — PKR ${fineAmount.toLocaleString()} (salary/30) deducted`;

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

          // WhatsApp: only employee gets notified directly. Partners don't
          // receive copies (per Wasif: "DAILY REPORT WILL ONLY BE SENT TO MY
          // NUMBERS NO THEM"). Admin alerts continue to route via CEO settings.
          if (fineAmount > 0 && emp.phone) {
            try {
              const { sendAbsentTemplate } = await import("@/lib/services/whatsapp.service");
              const empName = `${emp.firstName} ${emp.lastName || ""}`.trim();
              sendAbsentTemplate(emp.phone, empName, fineAmount).catch((err: any) =>
                console.warn(`WhatsApp absent failed for ${emp.employeeId}:`, err.message)
              );
            } catch {}
          }

          officeResults.push({
            employeeId: emp.employeeId,
            name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
            action: "marked_absent",
            fine: fineAmount,
            coveredByPaidLeave: covered,
          });
        }
      }

      perOfficeResults.push({
        office: office.slug,
        processed: officeResults.length,
        results: officeResults,
      });
    }

    return json({
      message: `Processed ${offices.length} office(s)`,
      date: today.toISOString(),
      offices: perOfficeResults,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
