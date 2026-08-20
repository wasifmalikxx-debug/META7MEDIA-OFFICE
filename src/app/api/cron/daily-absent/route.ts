import { NextRequest } from "next/server";
import { json, error, serverError, requireCronSecret, isMaintenanceMode } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { createFineDedup } from "@/lib/services/fine.service";
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
  const gate = requireCronSecret(request);
  if (gate) return gate;

  // Stand down while the portal is locked.
  //
  // Maintenance mode removes the only way to check in — the attendance UI —
  // so without this guard this cron would mark every single employee ABSENT,
  // fine each one a day's salary (salary/30), push it into payroll and
  // WhatsApp them about it. Punishing 35 people for a lockout the office
  // imposed is the opposite of what the flag is for.
  if (isMaintenanceMode()) {
    return json({ skipped: "maintenance_mode", marked: 0, fined: 0 });
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
      // Track every employee who got a fine this run so we can push the
      // fine into their payroll record at the end (CEO 2026-06-09: every
      // daily-activity fine must reflect in payroll, no exceptions).
      const finedUserIds = new Set<string>();

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

          await createFineDedup({
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
          finedUserIds.add(emp.id);

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

      // ─── PASS 2 — No-show on the working half of a half-day leave ───
      //
      // Catches the gap surfaced 2026-05-31 by the CEO using
      // SMM-2 M. Ahmad Aslam's May 30 case:
      //   - Filed APPROVED HALF_DAY FIRST_HALF on May 30
      //   - Attendance row created with status=HALF_DAY (by Pass 1 above
      //     OR by an earlier same-day file flow)
      //   - Never checked in for the SECOND_HALF he was supposed to work
      //   - Got paid for the half he took off (correct), but NO fine for
      //     the half he skipped (the bug — he effectively got a full
      //     unpaid no-show pass)
      //
      // Fix: a half-day leave only covers ONE half. If the OTHER half is
      // a no-show, charge dailyRate × 0.5 (mirror the half they skipped).
      // Reuses ABSENT_WITHOUT_LEAVE type so the new fine flows through
      // payroll's "Absent deductions" line + the dashboard split landed
      // in commit 28efe9c.
      const halfDayNoShows = await prisma.attendance.findMany({
        where: {
          date: today,
          userId: { in: employees.map((e) => e.id) },
          status: "HALF_DAY",
          checkIn: null,
        },
        select: { userId: true },
      });

      if (halfDayNoShows.length > 0) {
        const halfPeriodByUser = new Map<string, string>();
        const todayHalfDayLeaves = await prisma.leaveRequest.findMany({
          where: {
            userId: { in: halfDayNoShows.map((a) => a.userId) },
            startDate: { lte: today },
            endDate: { gte: today },
            status: "APPROVED",
            leaveType: "HALF_DAY",
          },
          select: { userId: true, halfDayPeriod: true },
        });
        for (const l of todayHalfDayLeaves) {
          if (l.halfDayPeriod) halfPeriodByUser.set(l.userId, l.halfDayPeriod);
        }

        for (const ns of halfDayNoShows) {
          const emp = employees.find((e) => e.id === ns.userId);
          if (!emp) continue;

          const halfPeriod = halfPeriodByUser.get(ns.userId);
          if (!halfPeriod) {
            // HALF_DAY status without an approved half-day leave is unusual
            // (legacy data / manual override). Skip — don't fine in this
            // case since we can't be sure which half they were supposed
            // to work.
            continue;
          }

          const monthlySalary = emp.salaryStructure?.monthlySalary || 0;
          const halfDayFine = Math.round((monthlySalary / 30) * 0.5);
          if (halfDayFine <= 0) continue;

          // Idempotency: cron may be re-run during the same day. The
          // "marked_absent" path above relies on attendance row presence;
          // here the attendance row stays HALF_DAY across reruns, so we
          // de-dupe by checking for an existing no-show fine.
          const existing = await prisma.fine.findFirst({
            where: {
              userId: emp.id,
              date: today,
              type: "ABSENT_WITHOUT_LEAVE",
              reason: { contains: "No-show on working half" },
            },
            select: { id: true, amount: true },
          });
          if (existing) {
            officeResults.push({
              employeeId: emp.employeeId,
              action: "no_show_half_fine_exists",
              fine: existing.amount,
            });
            continue;
          }

          const skippedHalf =
            halfPeriod === "FIRST_HALF" ? "SECOND_HALF" : "FIRST_HALF";
          const fineReason =
            `No-show on working half of approved ${halfPeriod} leave — ` +
            `${skippedHalf} not attended — PKR ${halfDayFine.toLocaleString()} ` +
            `(salary/30 × 0.5) deducted`;

          await createFineDedup({
            data: {
              userId: emp.id,
              type: "ABSENT_WITHOUT_LEAVE",
              amount: halfDayFine,
              reason: fineReason,
              date: today,
              month,
              year,
              issuedById: admin?.id || emp.id,
            },
          });
          finedUserIds.add(emp.id);

          officeResults.push({
            employeeId: emp.employeeId,
            name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
            action: "no_show_half_day_fined",
            fine: halfDayFine,
            leaveTaken: halfPeriod,
            halfNotAttended: skippedHalf,
          });
        }
      }

      // ─── Push every fine created this run into the matching payroll ──
      // record so it reflects immediately (CEO 2026-06-09). Serialized to
      // avoid hammering the DB pool; each is PAID/locked-safe internally.
      let synced = 0;
      if (finedUserIds.size > 0) {
        const { syncPayrollSafe } = await import("@/lib/services/payroll-sync.service");
        for (const uid of finedUserIds) {
          await syncPayrollSafe(uid, month, year);
          synced++;
        }
      }

      perOfficeResults.push({
        office: office.slug,
        processed: officeResults.length,
        payrollSynced: synced,
        results: officeResults,
      });
    }

    return json({
      message: `Processed ${offices.length} office(s)`,
      date: today.toISOString(),
      offices: perOfficeResults,
    });
  } catch (err: any) {
    return serverError(err, "Something went wrong. Please try again.", 500);
  }
}
