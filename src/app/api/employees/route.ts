import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
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
  // Employees can only see their own via other endpoints
  if (role === "EMPLOYEE") {
    return error("Forbidden", 403);
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
  const session = await requireRole("SUPER_ADMIN");
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
    const year = new Date().getFullYear();

    const employee = await prisma.user.create({
      data: {
        employeeId: parsed.employeeId,
        email: parsed.email,
        password: hashedPassword,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        phone: parsed.phone,
        role: parsed.role as any,
        designation: parsed.designation,
        departmentId: parsed.departmentId || null,
        teamId: parsed.teamId || null,
        managerId: parsed.managerId || null,
        joiningDate: new Date(parsed.joiningDate),
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

    return json(employee, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
