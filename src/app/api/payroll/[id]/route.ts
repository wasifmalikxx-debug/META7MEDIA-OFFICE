import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/services/notification.service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const record = await prisma.payrollRecord.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          employeeId: true,
          designation: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  if (!record) return error("Not found", 404);

  const role = (session.user as any).role;
  if (role === "EMPLOYEE" && record.userId !== session.user.id) {
    return error("Forbidden", 403);
  }

  // Get fines and incentives breakdown
  const [fines, incentives] = await Promise.all([
    prisma.fine.findMany({
      where: { userId: record.userId, month: record.month, year: record.year },
    }),
    prisma.incentive.findMany({
      where: { userId: record.userId, month: record.month, year: record.year },
    }),
  ]);

  return json({ ...record, fines, incentives });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;
  const body = await request.json();

  const record = await prisma.payrollRecord.findUnique({ where: { id } });
  if (!record) return error("Not found", 404);

  // CEO can override anything
  const updateData: any = {};
  if (body.status !== undefined) {
    updateData.status = body.status;
    if (body.status === "PAID") updateData.paidAt = new Date();
    if (body.status === "DRAFT") updateData.paidAt = null;
  }
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.paymentProof !== undefined) updateData.paymentProof = body.paymentProof;
  // CEO can edit all salary fields
  if (body.monthlySalary !== undefined) updateData.monthlySalary = body.monthlySalary;
  if (body.absentDays !== undefined) updateData.absentDays = body.absentDays;
  if (body.totalFines !== undefined) updateData.totalFines = body.totalFines;
  if (body.totalDeductions !== undefined) updateData.totalDeductions = body.totalDeductions;
  if (body.totalIncentives !== undefined) updateData.totalIncentives = body.totalIncentives;
  if (body.netSalary !== undefined) updateData.netSalary = body.netSalary;
  if (body.earnedSalary !== undefined) updateData.earnedSalary = body.earnedSalary;

  const updated = await prisma.payrollRecord.update({
    where: { id },
    data: updateData,
  });

  if (body.status === "PAID") {
    await createNotification(
      record.userId,
      "PAYROLL_GENERATED",
      "Salary Processed",
      `Your salary for ${record.month}/${record.year} has been processed. Net payable: PKR ${record.netSalary.toLocaleString()}`,
      `/payroll/${id}`
    );

    // WhatsApp: salary paid notification (fire-and-forget)
    try {
      const { notifyEmployee, salaryPaidMsg } = await import("@/lib/services/whatsapp.service");
      const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { firstName: true, lastName: true } });
      const empName = user ? `${user.firstName} ${user.lastName || ""}`.trim() : "Employee";
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthStr = `${months[record.month - 1]} ${record.year}`;
      notifyEmployee(
        record.userId,
        salaryPaidMsg(empName, record.netSalary, monthStr)
      ).catch(() => {});
    } catch {}
  }

  return json(updated);
}
