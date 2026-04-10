import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT, formatPKTDate } from "@/lib/pkt";
import { leaveActionSchema } from "@/lib/validations/leave";
import { createNotification } from "@/lib/services/notification.service";
import { resolveAttendanceStatus } from "@/lib/services/attendance-status";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) return error("Not found", 404);
  if (leave.userId !== session.user.id && (session.user as any).role !== "SUPER_ADMIN") {
    return error("Forbidden", 403);
  }
  // 15-minute edit window for employees, admin can always cancel
  const isAdmin = (session.user as any).role === "SUPER_ADMIN";
  if (!isAdmin && leave.userId === session.user.id) {
    const minutesSinceCreated = Math.floor((Date.now() - leave.createdAt.getTime()) / 60000);
    if (minutesSinceCreated > 15) {
      return error("Leave can only be cancelled within 15 minutes of applying");
    }
  }

  await prisma.leaveRequest.delete({ where: { id } });

  // If this was a half-day leave, restore attendance status from stale HALF_DAY
  // (the resolver will see no leave exists and correct it to PRESENT/LATE)
  if (leave.leaveType === "HALF_DAY") {
    const attendance = await prisma.attendance.findUnique({
      where: { userId_date: { userId: leave.userId, date: leave.startDate } },
    });
    if (attendance) {
      const resolved = await resolveAttendanceStatus({
        userId: leave.userId,
        date: leave.startDate,
        workedMinutes: attendance.workedMinutes || 0,
        lateMinutes: attendance.lateMinutes,
        currentStatus: attendance.status,
      });
      if (resolved.status !== attendance.status) {
        await prisma.attendance.update({
          where: { id: attendance.id },
          data: { status: resolved.status },
        });
      }
    }
  }

  return json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const body = await request.json();

  // Employee editing their own leave
  if (body.leaveType) {
    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) return error("Not found", 404);
    if (leave.userId !== session.user.id) return error("Forbidden", 403);
    // 15-minute edit window
    const minutesSinceCreated = Math.floor((Date.now() - leave.createdAt.getTime()) / 60000);
    if (minutesSinceCreated > 15) return error("Leave can only be edited within 15 minutes of applying");

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        leaveType: body.leaveType,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        totalDays: body.leaveType === "HALF_DAY" ? 0.5 : 1,
        reason: body.reason,
      },
    });
    return json(updated);
  }

  // Admin approve/reject
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") return error("Forbidden", 403);

  try {
    const parsed = leaveActionSchema.parse(body);

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!leave) return error("Leave request not found", 404);
    if (leave.status !== "PENDING") return error("Leave already processed");

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: parsed.action as any,
        approverId: session.user.id,
        approvedAt: nowPKT(),
        rejectionReason: parsed.rejectionReason,
      },
    });

    if (parsed.action === "APPROVED") {
      // Update leave balance
      const year = leave.startDate.getFullYear();
      if (leave.leaveType === "CASUAL" || leave.leaveType === "SICK") {
        const field =
          leave.leaveType === "CASUAL" ? "casualUsed" : "sickUsed";
        await prisma.leaveBalance.upsert({
          where: { userId_year: { userId: leave.userId, year } },
          create: {
            userId: leave.userId,
            year,
            [field]: leave.totalDays,
          },
          update: {
            [field]: { increment: leave.totalDays },
          },
        });
      }

      // Mark attendance as ON_LEAVE for leave dates
      const start = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      for (
        let d = new Date(start);
        d <= end;
        d.setDate(d.getDate() + 1)
      ) {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);
        await prisma.attendance.upsert({
          where: { userId_date: { userId: leave.userId, date } },
          create: {
            userId: leave.userId,
            date,
            status: "ON_LEAVE",
            isManualEntry: true,
            approvedBy: session.user.id,
            notes: `${leave.leaveType} leave approved`,
          },
          update: {
            status: "ON_LEAVE",
            notes: `${leave.leaveType} leave approved`,
          },
        });
      }

      await createNotification(
        leave.userId,
        "LEAVE_APPROVED",
        "Leave Approved",
        `Your ${leave.leaveType} leave from ${formatPKTDate(leave.startDate)} to ${formatPKTDate(leave.endDate)} has been approved.`,
        "/leaves"
      );
    } else {
      await createNotification(
        leave.userId,
        "LEAVE_REJECTED",
        "Leave Rejected",
        `Your ${leave.leaveType} leave request has been rejected.${parsed.rejectionReason ? ` Reason: ${parsed.rejectionReason}` : ""}`,
        "/leaves"
      );
    }

    return json(updated);
  } catch (err: any) {
    return error(err.message);
  }
}
