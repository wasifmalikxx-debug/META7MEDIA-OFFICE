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

  if (record.status === "PAID") {
    return error("Cannot modify a paid payroll record");
  }

  const updated = await prisma.payrollRecord.update({
    where: { id },
    data: {
      status: body.status,
      notes: body.notes,
      paymentProof: body.paymentProof || undefined,
      paidAt: body.status === "PAID" ? new Date() : undefined,
    },
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
