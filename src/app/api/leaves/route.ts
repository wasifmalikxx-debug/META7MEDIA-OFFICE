import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { leaveRequestSchema } from "@/lib/validations/leave";
import { createNotification, notifyAdmins } from "@/lib/services/notification.service";

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

    let totalDays: number;
    if (parsed.leaveType === "HALF_DAY") {
      totalDays = 0.5;
    } else {
      totalDays = Math.floor(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
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
        startDate,
        endDate,
        totalDays,
        reason: parsed.reason,
        status: "APPROVED",
        approvedBy: session.user.id,
      },
    });

    // Auto-checkout if half-day leave is for today and employee is checked in
    if (parsed.leaveType === "HALF_DAY") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (startDate.getTime() === today.getTime()) {
        const activeAttendance = await prisma.attendance.findFirst({
          where: {
            userId: session.user.id,
            date: today,
            checkOut: null,
          },
        });
        if (activeAttendance) {
          const now = new Date();
          const checkIn = new Date(activeAttendance.checkIn);
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
              totalHours: Math.round((workingMinutes / 60) * 100) / 100,
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
