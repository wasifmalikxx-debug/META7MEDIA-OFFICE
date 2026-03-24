import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { leaveActionSchema } from "@/lib/validations/leave";
import { createNotification } from "@/lib/services/notification.service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;

  try {
    const body = await request.json();
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
        approvedAt: new Date(),
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
        `Your ${leave.leaveType} leave from ${leave.startDate.toLocaleDateString()} to ${leave.endDate.toLocaleDateString()} has been approved.`,
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
