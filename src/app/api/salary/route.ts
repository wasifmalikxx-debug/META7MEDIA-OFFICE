import { NextRequest } from "next/server";
import { json, error, serverError, requireAuth, requireRole, getCallerScope, assertCanActOnUser } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { salaryStructureSchema } from "@/lib/validations/payroll";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") || session.user.id;

  // Object-level authz (H2): CEO → anyone; PARTNER → own-team members;
  // everyone else (MANAGER/EMPLOYEE/HR) → self only. Salary is highly
  // sensitive; the old check only blocked EMPLOYEE, letting a MANAGER/PARTNER
  // read any user's salary via ?userId=.
  const scope = await getCallerScope(session);
  if (!scope) return error("Forbidden", 403);
  const denied = await assertCanActOnUser(scope, userId);
  if (denied) return denied;

  const salary = await prisma.salaryStructure.findUnique({
    where: { userId },
    include: { user: { select: { firstName: true, lastName: true, employeeId: true } } },
  });

  return json(salary);
}

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const parsed = salaryStructureSchema.parse(body);

    const salary = await prisma.salaryStructure.upsert({
      where: { userId: parsed.userId },
      create: {
        userId: parsed.userId,
        monthlySalary: parsed.monthlySalary,
        currency: parsed.currency || "PKR",
        taxPercent: parsed.taxPercent || 0,
        socialSecurity: parsed.socialSecurity || 0,
        otherDeductions: parsed.otherDeductions || 0,
        deductionNotes: parsed.deductionNotes,
        effectiveFrom: new Date(parsed.effectiveFrom),
      },
      update: {
        monthlySalary: parsed.monthlySalary,
        currency: parsed.currency || "PKR",
        taxPercent: parsed.taxPercent || 0,
        socialSecurity: parsed.socialSecurity || 0,
        otherDeductions: parsed.otherDeductions || 0,
        deductionNotes: parsed.deductionNotes,
      },
    });

    return json(salary);
  } catch (err: any) {
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
