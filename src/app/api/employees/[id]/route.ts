import { NextRequest } from "next/server";
import { json, error, serverError, requireAuth, requireRole, getCallerScope, assertCanActOnUser } from "@/lib/api-helpers";
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
  const scope = await getCallerScope(session);
  if (!scope) return error("Forbidden", 403);

  // PARTNER can read members of their own team(s) only. CEO unrestricted.
  // Employee can read self.
  const denied = await assertCanActOnUser(scope, id);
  if (denied) return denied;

  const employee = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      phone2: true,
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
  // Phase 5: PARTNER can edit their team's employees (including salary).
  const session = await requireRole("SUPER_ADMIN", "PARTNER");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;
  const scope = await getCallerScope(session);
  if (!scope) return error("Forbidden", 403);

  const denied = await assertCanActOnUser(scope, id);
  if (denied) return denied;

  // Declared outside the try so the P2002 handler below can name the field
  // the caller actually sent.
  let body: any;
  try {
    body = await request.json();
    const parsed = updateEmployeeSchema.parse(body);

    // Partners aren't on payroll — block salary/bank writes regardless of
    // what the client sends. Otherwise the form's default monthlySalary: 0
    // would create a zero-PKR salaryStructure and pull them onto the CEO's
    // payroll list. Look up the target's current role to decide.
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true, status: true },
    });
    const isPartnerTarget = target?.role === "PARTNER";

    const updateData: any = { ...parsed };
    // H4 (full): only the CEO may change privileged identity / role / org /
    // credential / status fields. These reach the update via TWO paths — the
    // parsed-body spread (role/email/dept/team/manager) AND the raw-body
    // handling below (employeeId/newPassword/status) — so a non-CEO must be
    // blocked on BOTH. Without this a PARTNER editing a teammate (or, since
    // assertCanActOnUser allows self, themselves) could escalate to
    // SUPER_ADMIN, move people between teams/depts, reset a teammate's password
    // (full account takeover), hijack their login email, rewrite their
    // employeeId, or set status=TERMINATED to lock them out (DoS via the H1
    // gate). The CEO's Edit-Employee form keeps full control (scope.isCeo).
    // A partner retains benign profile edits (name/phone/designation/joining)
    // plus the existing Phase-5 bank/salary capability (handled below).
    if (!scope.isCeo) {
      delete updateData.role;
      delete updateData.departmentId;
      delete updateData.teamId;
      delete updateData.managerId;
      delete updateData.email; // login identity — CEO only (comes via parsed)
    }
    if (parsed.joiningDate) updateData.joiningDate = new Date(parsed.joiningDate);
    delete updateData.monthlySalary;

    // Privileged identity / credential / status fields come from the RAW body
    // (not the validated `parsed`), so the schema is not a gate — this is.
    // CEO only.
    if (scope.isCeo) {
      if (body.employeeId) updateData.employeeId = body.employeeId;
      if (body.email) updateData.email = body.email;
      if (body.newPassword && body.newPassword.length >= 6) {
        updateData.password = await bcrypt.hash(body.newPassword, 12);
      }
      if (body.status) updateData.status = body.status;
    } else if (body.status && body.status !== target?.status) {
      // Partner status control (CEO authorized Jul 10 2026): a PARTNER may set
      // ANY employment status — including offboarding (RESIGNED/TERMINATED) and
      // reversing it — on their OWN team's EMPLOYEES. assertCanActOnUser already
      // limits them to their team; status is not a privilege (role/org/email/
      // credentials stay CEO-only via the deletes above + the CEO-only raw
      // block). Guard: a partner may NOT change the status of another PARTNER or
      // the CEO — no locking out a peer/admin (also covers the self-edit path,
      // since the caller here is a partner). Only fires on an actual CHANGE, so
      // editing other fields (which resend the current status) is never blocked.
      const VALID_STATUSES = ["HIRED", "PROBATION", "RESIGNED", "TERMINATED"];
      // Allowlist (NOT a denylist): partners may change status ONLY for a
      // regular EMPLOYEE on their team — never the CEO (SUPER_ADMIN), an
      // HR_ADMIN, another PARTNER, or a MANAGER. Using role==="EMPLOYEE" is
      // robust to any privileged role added to the enum later; a denylist would
      // silently let a new role through. assertCanActOnUser already scopes to
      // their team; this protects the privileged tiers that can sit within it.
      if (target?.role !== "EMPLOYEE") {
        return error("Partners can only change the status of their team's employees.", 403);
      }
      if (VALID_STATUSES.includes(body.status)) {
        updateData.status = body.status;
      } else {
        return error("Invalid employee status.", 400);
      }
    }
    delete updateData.newPassword;
    // Handle bank details (skipped for partners)
    if (!isPartnerTarget) {
      if (body.bankName !== undefined) updateData.bankName = body.bankName || null;
      if (body.accountNumber !== undefined) updateData.accountNumber = body.accountNumber || null;
      if (body.accountTitle !== undefined) updateData.accountTitle = body.accountTitle || null;
    }

    const employee = await prisma.user.update({
      where: { id },
      data: updateData,
      // H5: never echo secrets back in the response. The base GET already uses
      // a whitelist that excludes these; PATCH must match so a partner editing
      // a teammate (or the CEO) can't receive the bcrypt hash / bank details.
      omit: {
        password: true,
        bankName: true,
        accountNumber: true,
        accountTitle: true,
        googleSheetUrl: true,
      },
    });

    // Update salary if provided — never for partners.
    if (!isPartnerTarget && body.monthlySalary !== undefined) {
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
    // A duplicate employee ID / email is the most common edit failure and the
    // generic message told the CEO nothing — a RESIGNED or TERMINATED person
    // still holds their id but doesn't appear in the employee list, so a free
    // -looking id silently 400s (hit Aug 8 2026 renaming "EM5" to "ME-5",
    // which Ahmad Mehmood still holds). Name the field AND who holds it.
    if (err?.code === "P2002") {
      const fields: string[] = Array.isArray(err?.meta?.target) ? err.meta.target : [];
      if (fields.includes("employeeId") && body?.employeeId) {
        const holder = await prisma.user.findUnique({
          where: { employeeId: String(body.employeeId) },
          select: { firstName: true, lastName: true, status: true },
        }).catch(() => null);
        const who = holder
          ? ` — already used by ${holder.firstName} ${holder.lastName ?? ""}`.trimEnd() +
            (holder.status === "RESIGNED" || holder.status === "TERMINATED"
              ? ` (${holder.status.toLowerCase()}, so they don't show in the employee list)`
              : "")
          : " — already used by another account";
        return error(`Employee ID "${body.employeeId}" is taken${who}. Pick a different ID.`, 409);
      }
      if (fields.includes("email") && body?.email) {
        return error(`The email "${body.email}" is already used by another account.`, 409);
      }
      return error("That value is already used by another account.", 409);
    }
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Phase 5: PARTNER can delete employees on their team(s). CEO unrestricted.
  const session = await requireRole("SUPER_ADMIN", "PARTNER");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;
  const scope = await getCallerScope(session);
  if (!scope) return error("Forbidden", 403);

  const denied = await assertCanActOnUser(scope, id);
  if (denied) return denied;

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
