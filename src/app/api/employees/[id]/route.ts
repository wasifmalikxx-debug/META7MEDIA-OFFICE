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
      leaveBalances: { where: { year: new Date(Date.now() + 5 * 60 * 60_000).getUTCFullYear() } },
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
          effectiveFrom: new Date(Date.now() + 5 * 60 * 60_000),
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

  // Safety: the signed-in admin can't delete their own account this way.
  if (id === session.user.id) {
    return error("You can't delete your own account.", 400);
  }

  // ── Pre-flight check: is this user referenced as an admin/approver on
  // records that BELONG to other employees? Those are non-nullable FKs
  // (fine.issuedById, warning.issuedById, etc.) so Prisma will refuse to
  // delete the row. Surface a clear message instead of the generic error.
  //
  // We only count references on OTHER users' records — refs to this user's
  // OWN records (self-issued, self-sent) get cascade-cleaned below.
  const [
    finesIssuedToOthers,
    incentivesGivenToOthers,
    warningsIssuedToOthers,
    announcementsAuthored,
    payrollSnapshotsLocked,
    complaintMessagesOnOtherComplaints,
    subordinates,
  ] = await Promise.all([
    prisma.fine.count({ where: { issuedById: id, userId: { not: id } } }),
    prisma.incentive.count({ where: { givenById: id, userId: { not: id } } }),
    prisma.warning.count({ where: { issuedById: id, userId: { not: id } } }),
    prisma.announcement.count({ where: { authorId: id } }),
    prisma.payrollSnapshot.count({ where: { lockedById: id } }),
    prisma.complaintMessage.count({ where: { senderId: id, complaint: { userId: { not: id } } } }),
    prisma.user.count({ where: { managerId: id } }),
  ]);

  const blockers: string[] = [];
  if (finesIssuedToOthers > 0) blockers.push(`${finesIssuedToOthers} fine(s) issued to other employees`);
  if (incentivesGivenToOthers > 0) blockers.push(`${incentivesGivenToOthers} incentive(s) given to other employees`);
  if (warningsIssuedToOthers > 0) blockers.push(`${warningsIssuedToOthers} warning(s) issued to other employees`);
  if (announcementsAuthored > 0) blockers.push(`${announcementsAuthored} announcement(s) authored`);
  if (payrollSnapshotsLocked > 0) blockers.push(`${payrollSnapshotsLocked} payroll snapshot(s) locked`);
  if (complaintMessagesOnOtherComplaints > 0) blockers.push(`${complaintMessagesOnOtherComplaints} complaint message(s) sent on others' complaints`);
  if (subordinates > 0) blockers.push(`${subordinates} employee(s) report to them as manager`);

  if (blockers.length > 0) {
    return error(
      `Can't delete this employee because they have admin/approver records on other employees: ${blockers.join("; ")}. Reassign or clear those first.`,
      409
    );
  }

  // All clear — delete everything owned by this user in dependency order.
  // Complaint messages cascade-delete with the complaint itself (schema-level
  // onDelete: Cascade). Nullable approver/updater references on other users'
  // rows are nulled out so those rows survive the delete.
  await prisma.$transaction([
    // 1. Null out nullable approver/updater refs on other records
    prisma.leaveRequest.updateMany({ where: { approverId: id }, data: { approverId: null } }),
    prisma.bonusEligibility.updateMany({ where: { updatedById: id }, data: { updatedById: null } }),
    prisma.reviewBonus.updateMany({ where: { approvedById: id }, data: { approvedById: null } }),
    prisma.complaint.updateMany({ where: { resolvedById: id }, data: { resolvedById: null } }),

    // 2. Delete all records owned by this user (order matters for FK chains)
    prisma.notification.deleteMany({ where: { userId: id } }),
    prisma.fine.deleteMany({ where: { userId: id } }),
    prisma.incentive.deleteMany({ where: { userId: id } }),
    prisma.payrollRecord.deleteMany({ where: { userId: id } }),
    prisma.leaveRequest.deleteMany({ where: { userId: id } }),
    prisma.leaveBalance.deleteMany({ where: { userId: id } }),
    prisma.attendance.deleteMany({ where: { userId: id } }),
    prisma.warning.deleteMany({ where: { userId: id } }),
    prisma.salaryStructure.deleteMany({ where: { userId: id } }),
    prisma.dailyReport.deleteMany({ where: { userId: id } }),
    prisma.deviceApproval.deleteMany({ where: { userId: id } }),
    prisma.bonusEligibility.deleteMany({ where: { userId: id } }),
    prisma.reviewBonus.deleteMany({ where: { userId: id } }),
    prisma.refund.deleteMany({ where: { userId: id } }),
    // Complaints — messages cascade-delete via schema relation
    prisma.complaint.deleteMany({ where: { userId: id } }),

    // 3. Finally delete the user row itself
    prisma.user.delete({ where: { id } }),
  ]);

  return json({ success: true });
}
