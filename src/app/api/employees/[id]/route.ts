import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { updateEmployeeSchema } from "@/lib/validations/employee";
import bcrypt from "bcryptjs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const role = (session.user as any).role;

  if (role === "EMPLOYEE" && id !== session.user.id) {
    return error("Forbidden", 403);
  }

  const employee = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      profilePhoto: true,
      role: true,
      status: true,
      designation: true,
      joiningDate: true,
      department: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      salaryStructure: true,
      leaveBalances: { where: { year: new Date().getFullYear() } },
    },
  });

  if (!employee) return error("Employee not found", 404);
  return json(employee);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = updateEmployeeSchema.parse(body);

    const updateData: any = { ...parsed };
    if (parsed.joiningDate) updateData.joiningDate = new Date(parsed.joiningDate);
    delete updateData.monthlySalary;
    // Handle employee ID
    if (body.employeeId) updateData.employeeId = body.employeeId;
    // Handle email
    if (body.email) updateData.email = body.email;
    // Handle password reset
    if (body.newPassword && body.newPassword.length >= 6) {
      updateData.password = await bcrypt.hash(body.newPassword, 12);
    }
    delete updateData.newPassword;
    // Handle bank details
    if (body.bankName !== undefined) updateData.bankName = body.bankName || null;
    if (body.accountNumber !== undefined) updateData.accountNumber = body.accountNumber || null;
    if (body.accountTitle !== undefined) updateData.accountTitle = body.accountTitle || null;
    if (body.status) updateData.status = body.status;

    const employee = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    // Update salary if provided
    if (body.monthlySalary !== undefined) {
      await prisma.salaryStructure.upsert({
        where: { userId: id },
        create: {
          userId: id,
          monthlySalary: body.monthlySalary,
          effectiveFrom: new Date(),
        },
        update: { monthlySalary: body.monthlySalary },
      });
    }

    return json(employee);
  } catch (err: any) {
    return error(err.message);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;

  // Delete all related records first
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { userId: id } }),
    prisma.fine.deleteMany({ where: { userId: id } }),
    prisma.incentive.deleteMany({ where: { userId: id } }),
    prisma.payrollRecord.deleteMany({ where: { userId: id } }),
    prisma.leaveRequest.deleteMany({ where: { userId: id } }),
    prisma.leaveBalance.deleteMany({ where: { userId: id } }),
    prisma.attendance.deleteMany({ where: { userId: id } }),
    prisma.warning.deleteMany({ where: { userId: id } }),
    prisma.salaryStructure.deleteMany({ where: { userId: id } }),
    prisma.user.delete({ where: { id } }),
  ]);

  return json({ success: true });
}
