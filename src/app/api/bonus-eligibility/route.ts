import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { bonusEligibilitySchema } from "@/lib/validations/bonus";
import { calculateEligibility } from "@/lib/services/bonus.service";
import { createNotification } from "@/lib/services/notification.service";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  const { searchParams } = new URL(request.url);
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));

  const where: any = { month, year };

  if (role === "EMPLOYEE") {
    // Employees see only their own record
    where.userId = session.user.id;
  } else {
    // SUPER_ADMIN / MANAGER see all Etsy department employees
    const etsyDept = await prisma.department.findUnique({ where: { name: "Etsy" } });
    if (etsyDept) {
      where.user = { departmentId: etsyDept.id };
    }
  }

  const records = await prisma.bonusEligibility.findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          employeeId: true,
          department: { select: { name: true } },
        },
      },
      updatedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json(records);
}

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    return error("Forbidden", 403);
  }

  try {
    const body = await request.json();
    const parsed = bonusEligibilitySchema.parse(body);

    // Auto-compute eligibility and bonus amount in PKR
    const result = calculateEligibility({
      dailyListingsComplete: parsed.dailyListingsComplete,
      ordersProcessedSameDay: parsed.ordersProcessedSameDay,
      messagesCleared: parsed.messagesCleared,
      zeroWrongOrders: parsed.zeroWrongOrders,
      listingsRemovedCount: parsed.listingsRemovedCount,
      allStoresAbove4Stars: parsed.allStoresAbove4Stars,
      totalProfit: parsed.totalProfit,
    });
    const isEligible = result.isEligible;
    const bonusAmount = result.bonusAmountPKR;

    const record = await prisma.bonusEligibility.upsert({
      where: {
        userId_month_year: {
          userId: parsed.userId,
          month: parsed.month,
          year: parsed.year,
        },
      },
      create: {
        userId: parsed.userId,
        month: parsed.month,
        year: parsed.year,
        dailyListingsComplete: parsed.dailyListingsComplete,
        ordersProcessedSameDay: parsed.ordersProcessedSameDay,
        messagesCleared: parsed.messagesCleared,
        zeroWrongOrders: parsed.zeroWrongOrders,
        listingsRemovedCount: parsed.listingsRemovedCount,
        allStoresAbove4Stars: parsed.allStoresAbove4Stars,
        totalProfit: parsed.totalProfit,
        isEligible,
        bonusAmount,
        notes: parsed.notes,
        updatedById: session.user.id,
      },
      update: {
        dailyListingsComplete: parsed.dailyListingsComplete,
        ordersProcessedSameDay: parsed.ordersProcessedSameDay,
        messagesCleared: parsed.messagesCleared,
        zeroWrongOrders: parsed.zeroWrongOrders,
        listingsRemovedCount: parsed.listingsRemovedCount,
        allStoresAbove4Stars: parsed.allStoresAbove4Stars,
        totalProfit: parsed.totalProfit,
        isEligible,
        bonusAmount,
        notes: parsed.notes,
        updatedById: session.user.id,
      },
    });

    // Notify the employee
    await createNotification(
      parsed.userId,
      "BONUS_ELIGIBILITY_UPDATED",
      "Bonus Eligibility Updated",
      `Your bonus eligibility for ${parsed.month}/${parsed.year} has been updated. ${isEligible ? "You are eligible!" : "You are not yet eligible."}`,
      "/bonus"
    );

    return json(record, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
