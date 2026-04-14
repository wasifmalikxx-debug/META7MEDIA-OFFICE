import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { leaveRequestSchema } from "@/lib/validations/leave";
import { createNotification, notifyAdmins } from "@/lib/services/notification.service";
import { todayPKT, nowPKT } from "@/lib/pkt";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const role = (session.user as any).role;
  const status = searchParams.get("status");
  const userId = searchParams.get("userId");

  const where: any = {};
  // Only SUPER_ADMIN / HR_ADMIN can see all leaves.
  // MANAGER and EMPLOYEE only see their own unless admin passes ?userId=
  if (role === "SUPER_ADMIN" || role === "HR_ADMIN") {
    if (userId) where.userId = userId;
  } else {
    where.userId = session.user.id;
  }
  if (status) where.status = status;

  const leaves = await prisma.leaveRequest.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      approver: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json(leaves);
}

/**
 * Parse a YYYY-MM-DD string to a Date at UTC midnight, without relying on
 * `new Date(str)` which can behave inconsistently across engines/locales.
 * Returns null if the string is malformed.
 */
function parseYMDStrict(input: string): Date | null {
  if (typeof input !== "string") return null;
  // Accept either "YYYY-MM-DD" or the datetime form "YYYY-MM-DDTHH:mm..."
  const ymd = input.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Verify round-trip (catches Feb 30 etc.)
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const body = await request.json();
    const parsed = leaveRequestSchema.parse(body);

    // Strict YYYY-MM-DD parser to guarantee the stored date matches what
    // the employee picked — no locale / timezone / engine surprises.
    const startDate = parseYMDStrict(parsed.startDate);
    const endDate = parseYMDStrict(parsed.endDate);
    if (!startDate || !endDate) {
      return error("Invalid date format. Please pick a date from the calendar.");
    }

    // Reason is required
    if (!parsed.reason || !parsed.reason.trim()) {
      return error("Please provide a valid reason for half day leave.");
    }

    let totalDays: number;
    if (parsed.leaveType === "HALF_DAY") {
      totalDays = 0.5;
    } else {
      totalDays = Math.floor(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
    }

    // Block past dates
    const today = todayPKT();
    if (startDate < today) {
      return error("Cannot apply leave for past dates.");
    }

    // Sanity check: reject leaves more than 30 days in the future. Prevents
    // accidental submissions where a wrong date slips through (e.g. the
    // employee types "10-04" meaning April 10 but it's interpreted oddly).
    const maxFuture = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (startDate > maxFuture) {
      return error(
        "Leave date is too far in the future. Please pick a date within the next 30 days."
      );
    }

    // For today's half day (second half only): must have checked in and completed 4h threshold
    if (parsed.leaveType === "HALF_DAY" && startDate.getTime() === today.getTime() && parsed.halfDayPeriod !== "FIRST_HALF") {
      // Check daily report submitted
      const dailyReport = await prisma.dailyReport.findUnique({
        where: { userId_date: { userId: session.user.id, date: today } },
      });
      if (!dailyReport) {
        return error("Please submit your daily report first.");
      }
      const todayAttendance = await prisma.attendance.findUnique({
        where: { userId_date: { userId: session.user.id, date: today } },
      });
      if (!todayAttendance?.checkIn) {
        return error("You must check in first before applying half day for today.");
      }
      if (todayAttendance.checkOut) {
        return error("You already checked out today.");
      }
      const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
      const threshold = settings?.halfDayThresholdMin ?? 240;
      const now = nowPKT();
      const checkInMs = todayAttendance.checkIn.getTime();
      let workedMs = now.getTime() - checkInMs;
      if (todayAttendance.breakStart) {
        const breakEndMs = todayAttendance.breakEnd ? todayAttendance.breakEnd.getTime() : now.getTime();
        workedMs -= (breakEndMs - todayAttendance.breakStart.getTime());
      }
      const workedMinutes = Math.floor(workedMs / 60000);
      if (workedMinutes < threshold) {
        const remaining = threshold - workedMinutes;
        const h = Math.floor(remaining / 60);
        const m = remaining % 60;
        return error(`Complete ${h}h ${m}m more work before applying half day (${Math.floor(threshold/60)}h minimum required).`);
      }
    }

    // Block duplicate leave for same date
    const existingLeave = await prisma.leaveRequest.findFirst({
      where: {
        userId: session.user.id,
        startDate,
        status: { not: "REJECTED" },
      },
    });
    if (existingLeave) {
      if (existingLeave.leaveType === "HALF_DAY") {
        return error("You already have a half day leave on this date.");
      }
      return error("You already have a leave on this date.");
    }

    // Check leave balance for casual/sick
    if (parsed.leaveType === "CASUAL" || parsed.leaveType === "SICK") {
      const year = startDate.getFullYear();
      const balance = await prisma.leaveBalance.findUnique({
        where: { userId_year: { userId: session.user.id, year } },
      });
      if (balance) {
        if (parsed.leaveType === "CASUAL") {
          const remaining = balance.casualTotal - balance.casualUsed;
          if (totalDays > remaining) {
            return error(
              `Insufficient casual leave balance. ${remaining} days remaining.`
            );
          }
        } else {
          const remaining = balance.sickTotal - balance.sickUsed;
          if (totalDays > remaining) {
            return error(
              `Insufficient sick leave balance. ${remaining} days remaining.`
            );
          }
        }
      }
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        userId: session.user.id,
        leaveType: parsed.leaveType as any,
        halfDayPeriod: parsed.leaveType === "HALF_DAY" ? (parsed.halfDayPeriod || "SECOND_HALF") : null,
        startDate,
        endDate,
        totalDays,
        reason: parsed.reason,
        status: "APPROVED",
        approverId: session.user.id,
        approvedAt: nowPKT(),
      },
    });

    // Auto-checkout if half-day leave is for today and employee is checked in
    if (parsed.leaveType === "HALF_DAY") {
      const todayHD = todayPKT();
      if (startDate.getTime() === todayHD.getTime()) {
        const activeAttendance = await prisma.attendance.findFirst({
          where: {
            userId: session.user.id,
            date: today,
            checkOut: null,
          },
        });
        if (activeAttendance) {
          const now = nowPKT();
          const checkIn = activeAttendance.checkIn ? new Date(activeAttendance.checkIn) : now;
          const totalMinutes = Math.floor((now.getTime() - checkIn.getTime()) / 60000);
          // Subtract break time if applicable
          let breakMinutes = 0;
          if (activeAttendance.breakStart && activeAttendance.breakEnd) {
            breakMinutes = Math.floor(
              (new Date(activeAttendance.breakEnd).getTime() - new Date(activeAttendance.breakStart).getTime()) / 60000
            );
          }
          const workingMinutes = totalMinutes - breakMinutes;

          await prisma.attendance.update({
            where: { id: activeAttendance.id },
            data: {
              checkOut: now,
              workedMinutes: workingMinutes,
              status: "HALF_DAY",
            },
          });
        }
      }
    }

    // Notify admins
    await notifyAdmins(
      "LEAVE_REQUEST",
      "New Leave Request",
      `${session.user.name} has requested ${totalDays} day(s) of ${parsed.leaveType} leave.`,
      "/leaves"
    );

    return json(leave, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
