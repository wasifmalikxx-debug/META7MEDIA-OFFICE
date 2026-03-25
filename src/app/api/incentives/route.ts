import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { incentiveSchema } from "@/lib/validations/payroll";
import { createNotification } from "@/lib/services/notification.service";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const role = (session.user as any).role;
  const userId = searchParams.get("userId");
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));

  const where: any = { month, year };
  if (role === "EMPLOYEE") {
    where.userId = session.user.id;
  } else if (userId) {
    where.userId = userId;
  }

  const incentives = await prisma.incentive.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      givenBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json(incentives);
}

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const parsed = incentiveSchema.parse(body);

    let amount = parsed.amount;
    if (parsed.type === "PERCENTAGE" && parsed.percentage) {
      const salary = await prisma.salaryStructure.findUnique({
        where: { userId: parsed.userId },
      });
      if (salary) {
        amount = Math.round((salary.monthlySalary * parsed.percentage) / 100 * 100) / 100;
      }
    }

    const incentive = await prisma.incentive.create({
      data: {
        userId: parsed.userId,
        type: parsed.type as any,
        amount,
        percentage: parsed.percentage,
        reason: parsed.reason,
        month: parsed.month,
        year: parsed.year,
        givenById: session.user.id,
      },
    });

    await createNotification(
      parsed.userId,
      "INCENTIVE_AWARDED",
      "Incentive Awarded",
      `You have been awarded an incentive of PKR ${amount.toLocaleString()}. Reason: ${parsed.reason}`,
      "/incentives"
    );

    return json(incentive, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
