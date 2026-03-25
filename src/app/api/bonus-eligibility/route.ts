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

    // WhatsApp: notify employee about bonus eligibility (fire-and-forget)
    if (isEligible && bonusAmount > 0) {
      try {
        const { notifyEmployee, bonusEligibleMsg } = await import("@/lib/services/whatsapp.service");
        const empUser = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { firstName: true, lastName: true } });
        const empName = empUser ? `${empUser.firstName} ${empUser.lastName || ""}`.trim() : "Employee";
        notifyEmployee(parsed.userId, bonusEligibleMsg(empName, parsed.totalProfit, bonusAmount)).catch(() => {});
      } catch {}
    }

    // Create or update Incentive record for profit bonus
    if (isEligible && bonusAmount > 0) {
      // Check if profit bonus incentive already exists for this month
      const existingIncentive = await prisma.incentive.findFirst({
        where: {
          userId: parsed.userId,
          month: parsed.month,
          year: parsed.year,
          reason: { startsWith: "Profit Bonus" },
        },
      });

      if (existingIncentive) {
        // Update existing incentive amount
        await prisma.incentive.update({
          where: { id: existingIncentive.id },
          data: { amount: bonusAmount },
        });
      } else {
        // Create new incentive
        await prisma.incentive.create({
          data: {
            userId: parsed.userId,
            type: "TARGET_BASED",
            amount: bonusAmount,
            reason: `Profit Bonus - $${parsed.totalProfit.toFixed(0)} profit → PKR ${bonusAmount.toLocaleString()}`,
            month: parsed.month,
            year: parsed.year,
            givenById: session.user.id,
          },
        });
      }
    } else {
      // If not eligible, remove ALL bonuses — profit AND review
      await prisma.incentive.deleteMany({
        where: {
          userId: parsed.userId,
          month: parsed.month,
          year: parsed.year,
          reason: { startsWith: "Profit Bonus" },
        },
      });
      // Also zero out review bonuses — reject all pending, remove incentives
      await prisma.incentive.deleteMany({
        where: {
          userId: parsed.userId,
          month: parsed.month,
          year: parsed.year,
          reason: { startsWith: "Bad Review Fix Bonus" },
        },
      });
      // Reject any pending review submissions
      await prisma.reviewBonus.updateMany({
        where: {
          userId: parsed.userId,
          month: parsed.month,
          year: parsed.year,
          status: "PENDING",
        },
        data: {
          status: "REJECTED",
          rejectionReason: "Not eligible — failed bonus criteria",
        },
      });
    }

    // Sync Team Lead bonus for Izaan (EM-4)
    const izaan = await prisma.user.findFirst({ where: { employeeId: "EM-4" } });
    if (izaan) {
      const allEligible = await prisma.bonusEligibility.findMany({
        where: { month: parsed.month, year: parsed.year, isEligible: true },
        include: { user: { select: { employeeId: true } } },
      });
      const eligibleCount = allEligible.filter(e => e.user.employeeId !== "EM-4").length;
      const teamLeadBonus = eligibleCount * 5000;

      const existingTL = await prisma.incentive.findFirst({
        where: { userId: izaan.id, month: parsed.month, year: parsed.year, reason: { startsWith: "Team Lead Bonus" } },
      });
      if (teamLeadBonus > 0) {
        if (existingTL) {
          await prisma.incentive.update({ where: { id: existingTL.id }, data: { amount: teamLeadBonus, reason: `Team Lead Bonus - ${eligibleCount} eligible employees × PKR 5,000` } });
        } else {
          await prisma.incentive.create({ data: { userId: izaan.id, type: "TARGET_BASED", amount: teamLeadBonus, reason: `Team Lead Bonus - ${eligibleCount} eligible employees × PKR 5,000`, month: parsed.month, year: parsed.year, givenById: session.user.id } });
        }

        // WhatsApp: notify Izaan about team lead bonus (fire-and-forget)
        try {
          const { notifyEmployee, teamLeadBonusMsg } = await import("@/lib/services/whatsapp.service");
          const izaanName = `${izaan.firstName} ${izaan.lastName || ""}`.trim();
          notifyEmployee(izaan.id, teamLeadBonusMsg(izaanName, eligibleCount, teamLeadBonus)).catch(() => {});
        } catch {}
      } else if (existingTL) {
        await prisma.incentive.delete({ where: { id: existingTL.id } });
      }
    }

    // Sync payroll record with updated incentives
    try {
      const { syncPayrollRecord } = await import("@/lib/services/payroll-sync.service");
      await syncPayrollRecord(parsed.userId, parsed.month, parsed.year);
      // Also sync Izaan's payroll if team lead bonus changed
      if (izaan) await syncPayrollRecord(izaan.id, parsed.month, parsed.year);
    } catch {}

    // Notify the employee
    await createNotification(
      parsed.userId,
      "BONUS_ELIGIBILITY_UPDATED",
      "Bonus Eligibility Updated",
      `Your bonus eligibility for ${parsed.month}/${parsed.year} has been updated. ${isEligible ? `You are eligible! PKR ${bonusAmount.toLocaleString()} bonus.` : "You are not yet eligible."}`,
      "/bonus"
    );

    return json(record, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
