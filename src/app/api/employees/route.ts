import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { json, error, requireAuth, requireRole, getCallerScope } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { createEmployeeSchema } from "@/lib/validations/employee";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  const { searchParams } = new URL(request.url);
  const dept = searchParams.get("department");
  const status = searchParams.get("status");

  if (role === "EMPLOYEE") {
    return error("Forbidden", 403);
  }

  const where: any = {};
  if (dept) where.departmentId = dept;
  if (status) where.status = status;

  // Multi-office scoping: PARTNER sees only their team(s); CEO + HR_ADMIN see
  // the full roster. L3: MANAGER (Izaan) is scoped to his OWN department
  // (Etsy - EM) — he must not see the full cross-office roster (matches the
  // documented Izaan-EM-only rule). The forced departmentId overrides any
  // ?department query param so he can't read other departments.
  const scope = await getCallerScope(session);
  if (scope?.isPartner) {
    where.officeId = scope.officeId;
    where.teamId = { in: [...(scope.teamIds ?? [])] };
  } else if (role === "MANAGER") {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { departmentId: true },
    });
    where.departmentId = me?.departmentId ?? "__none__";
  }

  const employees = await prisma.user.findMany({
    where,
    select: {
      id: true,
      employeeId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      phone2: true,
      role: true,
      status: true,
      designation: true,
      joiningDate: true,
      department: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { firstName: "asc" },
  });

  return json(employees);
}

export async function POST(request: NextRequest) {
  // Phase 5: PARTNER can also create employees, but server forces officeId
  // to caller's office and rejects creation outside their team(s).
  const session = await requireRole("SUPER_ADMIN", "PARTNER");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const parsed = createEmployeeSchema.parse(body);

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: parsed.email }, { employeeId: parsed.employeeId }],
      },
    });
    if (existing) {
      return error("Employee with this email or ID already exists");
    }

    const hashedPassword = await bcrypt.hash(parsed.password, 12);
    const year = new Date(Date.now() + 5 * 60 * 60_000).getUTCFullYear();

    const scope = await getCallerScope(session);
    if (!scope) return error("Your account has no office assigned", 400);

    // Office assignment: PARTNER's new hires always go to PARTNER's office.
    // CEO can override via body.officeId; defaults to CEO's own office.
    const targetOfficeId = scope.isCeo
      ? (body.officeId || scope.officeId)
      : scope.officeId;

    // Team assignment.
    //   CEO     → uses whatever teamId the form sent (or null).
    //   PARTNER → must land on one of their teams. If the form didn't send a
    //             teamId (the add-employee form uses department, not team) and
    //             the partner manages exactly one team, auto-assign that.
    let targetTeamId = parsed.teamId || (body.teamId as string | undefined) || null;
    if (scope.isPartner) {
      const partnerTeamIds = [...(scope.teamIds ?? [])];
      if (!targetTeamId && partnerTeamIds.length === 1) {
        targetTeamId = partnerTeamIds[0];
      }
      if (!targetTeamId || !scope.teamIds?.has(targetTeamId)) {
        return error("Partner can only add employees to their own team(s)", 403);
      }

      // Department guard: PARTNER's chosen department must match one of the
      // departments they own (i.e. department of one of their teams). This
      // blocks a malicious request that picks Etsy-AE while logged in as Zain.
      if (parsed.departmentId) {
        const ownDeptIds = await prisma.team.findMany({
          where: { partnerId: scope.userId },
          select: { departmentId: true },
        });
        const ownDeptIdSet = new Set(ownDeptIds.map((t) => t.departmentId));
        if (!ownDeptIdSet.has(parsed.departmentId)) {
          return error("Partner can only add employees to their own department(s)", 403);
        }
      }
    }

    // EMPLOYEE role only — partners can't create another partner/manager/admin.
    const targetRole = scope.isPartner ? "EMPLOYEE" : (parsed.role as any);

    const employee = await prisma.user.create({
      data: {
        employeeId: parsed.employeeId,
        email: parsed.email,
        password: hashedPassword,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        phone: parsed.phone,
        phone2: parsed.phone2 || null,
        role: targetRole,
        status: (body.status as any) || "HIRED",
        designation: parsed.designation,
        departmentId: parsed.departmentId || null,
        teamId: targetTeamId,
        officeId: targetOfficeId,
        joiningDate: new Date(parsed.joiningDate),
        bankName: body.bankName || null,
        accountNumber: body.accountNumber || null,
        accountTitle: body.accountTitle || null,
        leaveBalances: {
          create: { year },
        },
        salaryStructure: {
          create: {
            monthlySalary: parsed.monthlySalary,
            effectiveFrom: new Date(parsed.joiningDate),
          },
        },
      },
      select: {
        id: true,
        employeeId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    // Generate the current month's payroll record for the new hire so they
    // appear in payroll/dashboard totals immediately. Without this the
    // record is created lazily when someone first views payroll, causing
    // dashboard "Total Payable" to show 0 for newly added employees.
    try {
      const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
      const month = _pkt.getUTCMonth() + 1;
      const year = _pkt.getUTCFullYear();
      const { generatePayrollForEmployee } = await import("@/lib/services/payroll.service");
      await generatePayrollForEmployee(employee.id, month, year, session.user.id);
    } catch (err: any) {
      console.warn(`[employees] payroll generation failed for new hire ${employee.employeeId}:`, err.message);
    }

    return json(employee, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
