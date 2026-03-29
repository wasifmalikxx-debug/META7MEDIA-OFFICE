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
  if (role === "EMPLOYEE") {
    where.userId = session.user.id;
  } else if (userId) {
    where.userId = userId;
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

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const body = await request.json();
    const parsed = leaveRequestSchema.parse(body);

    const startDate = new Date(parsed.startDate);
    const endDate = new Date(parsed.endDate);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);

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
