import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { salaryStructureSchema } from "@/lib/validations/payroll";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") || session.user.id;
  const role = (session.user as any).role;

  if (role === "EMPLOYEE" && userId !== session.user.id) {
    return error("Forbidden", 403);
  }

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
    return error(err.message);
  }
}
