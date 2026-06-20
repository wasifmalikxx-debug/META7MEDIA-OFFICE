import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole, getCallerScope, assertCanActOnUser } from "@/lib/api-helpers";
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

  // Object-level authz (H3): CEO + HR_ADMIN → any record; PARTNER → own-team
  // members; MANAGER/EMPLOYEE → self only. The old check only blocked EMPLOYEE,
  // which let a MANAGER/PARTNER read any employee's full payslip via the id.
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "HR_ADMIN") {
    const scope = await getCallerScope(session);
    if (!scope) return error("Forbidden", 403);
    const denied = await assertCanActOnUser(scope, record.userId);
    if (denied) return denied;
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
  // Phase 5: PARTNER can mark their team's payroll PAID. CEO can do anything.
  const session = await requireRole("SUPER_ADMIN", "PARTNER");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;
  const body = await request.json();

  const record = await prisma.payrollRecord.findUnique({ where: { id } });
  if (!record) return error("Not found", 404);

  // Scope check: PARTNER can only act on payrolls of their team members.
  const scope = await getCallerScope(session);
  if (!scope) return error("Forbidden", 403);
  const denied = await assertCanActOnUser(scope, record.userId);
  if (denied) return denied;

  const updateData: any = {};
  if (body.status !== undefined) {
    updateData.status = body.status;
    if (body.status === "PAID") updateData.paidAt = new Date(Date.now() + 5 * 60 * 60_000);
    if (body.status === "DRAFT") { updateData.paidAt = null; updateData.paymentProof = null; }
  }
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.paymentProof !== undefined) updateData.paymentProof = body.paymentProof;
  // H7: only the CEO may hand-edit payroll MONEY fields. A PARTNER reaching
  // here (their own team) can still transition status / notes / paymentProof —
  // e.g. mark a record PAID — but must NOT silently alter settled amounts
  // (netSalary, fines, deductions, incentives, etc.). This closes the vector
  // where a non-CEO actor changes a settled/locked employee's pay. The
  // single source of truth stays payroll.service.ts; this is only the manual
  // override path.
  if (scope.isCeo) {
    if (body.monthlySalary !== undefined) updateData.monthlySalary = body.monthlySalary;
    if (body.absentDays !== undefined) updateData.absentDays = body.absentDays;
    if (body.totalFines !== undefined) updateData.totalFines = body.totalFines;
    if (body.totalDeductions !== undefined) updateData.totalDeductions = body.totalDeductions;
    if (body.totalIncentives !== undefined) updateData.totalIncentives = body.totalIncentives;
    if (body.netSalary !== undefined) updateData.netSalary = body.netSalary;
    if (body.earnedSalary !== undefined) updateData.earnedSalary = body.earnedSalary;
  }

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

    // WhatsApp: salary paid notification via template (fire-and-forget)
    try {
      const { sendSalaryPaidTemplate } = await import("@/lib/services/whatsapp.service");
      const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { firstName: true, lastName: true, phone: true } });
      const empName = user ? `${user.firstName} ${user.lastName || ""}`.trim() : "Employee";
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthStr = `${months[record.month - 1]} ${record.year}`;
      if (user?.phone) {
        sendSalaryPaidTemplate(user.phone, empName, record.netSalary, monthStr).catch(() => {});
      }
    } catch {}
  }

  return json(updated);
}
