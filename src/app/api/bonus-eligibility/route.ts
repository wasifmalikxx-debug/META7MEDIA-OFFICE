import { NextRequest } from "next/server";
import { json, error, serverError, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { bonusEligibilitySchema } from "@/lib/validations/bonus";
import { calculateEligibility } from "@/lib/services/bonus.service";
import { createNotification } from "@/lib/services/notification.service";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  const { searchParams } = new URL(request.url);
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(_pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(_pkt.getUTCFullYear()));

  const where: any = { month, year };

  if (role === "EMPLOYEE") {
    where.userId = session.user.id;
  } else if (role === "PARTNER") {
    // PARTNER sees bonus records for their team's Etsy employees only.
    const myTeam = await prisma.team.findFirst({
      where: { partnerId: session.user.id },
      select: { departmentId: true, department: { select: { name: true } } },
    });
    if (!myTeam || !myTeam.department.name.toLowerCase().includes("etsy")) {
      // Non-Etsy partner (Zain) — no records to show
      return json([]);
    }
    where.user = { departmentId: myTeam.departmentId };
  } else {
    // SUPER_ADMIN / MANAGER → primary office's Etsy department.
    const etsyDept = await prisma.department.findFirst({
      where: {
        office: { isPrimary: true },
        OR: [{ name: "Etsy - EM" }, { name: "Etsy" }],
      },
    });
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
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "PARTNER") {
    return error("Forbidden", 403);
  }

  try {
    const body = await request.json();
    const parsed = bonusEligibilitySchema.parse(body);

    // Scope (H6): PARTNER → own-team targets; MANAGER (Izaan) → own-department
    // targets and NEVER his own row (the CEO enters Izaan's bonus, mirroring
    // the review-bonus self-approval guard). Without this a MANAGER could set
    // any user's eligibility with an arbitrary profit, self-grant a Profit
    // Bonus, and/or inflate his own Team Lead Bonus. CEO (SUPER_ADMIN) skips
    // both branches and keeps full control.
    if (role === "PARTNER") {
      const { getCallerScope, assertCanActOnUser } = await import("@/lib/api-helpers");
      const scope = await getCallerScope(session);
      if (!scope) return error("Forbidden", 403);
      const denied = await assertCanActOnUser(scope, parsed.userId);
      if (denied) return denied;
    } else if (role === "MANAGER") {
      // MANAGER (Izaan, EM-4) may set eligibility ONLY for his own department's
      // employees — INCLUDING his own EM-4 row, which is legitimate: he runs his
      // own EM shops, appears in the EM bonus list (May-19-2026 design), and his
      // "Sync Profits" button loops every EM row incl. his own. His own row
      // cannot inflate his Team Lead Bonus because that tally already excludes
      // EM-4 everywhere (this route's team-lead block, the sync-profits cron, and
      // the BonusProgramView eligibleCount). Cross-department (AE/ME) writes stay
      // blocked, which is the actual escalation this guard prevents.
      const [me, target] = await Promise.all([
        prisma.user.findUnique({ where: { id: session.user.id }, select: { departmentId: true } }),
        prisma.user.findUnique({ where: { id: parsed.userId }, select: { departmentId: true } }),
      ]);
      if (!me?.departmentId || me.departmentId !== target?.departmentId) {
        return error("Forbidden — you can only act on your own department's employees", 403);
      }
    }

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

    // WhatsApp removed — only fines & salary paid get WhatsApp notifications

    // Block PROBATION employees from receiving incentives
    const empRecord = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { status: true } });
    const isOnProbation = empRecord?.status === "PROBATION";

    // Create or update Incentive record for profit bonus
    if (isEligible && bonusAmount > 0 && !isOnProbation) {
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
      // If not eligible for the profit bonus, remove ONLY the profit bonus
      // incentive. Review bonuses are independent now — they stay intact even
      // when the main 7-criteria eligibility fails. Only PROBATION status blocks
      // review bonuses (enforced at approval time in /api/review-bonus/[id]).
      await prisma.incentive.deleteMany({
        where: {
          userId: parsed.userId,
          month: parsed.month,
          year: parsed.year,
          reason: { startsWith: "Profit Bonus" },
        },
      });
      // Note: 'Bad Review Fix Bonus' incentives and pending reviewBonus
      // submissions are intentionally NOT touched here. Approved review fixes
      // remain in the employee's payroll regardless of profit bonus eligibility.
    }

    // Sync Team Lead bonus for Izaan (EM-4)
    // IMPORTANT: scope to Izaan's OWN department (Etsy - EM). AE and ME teams
    // have their own partners (Awais / Mubeen) who aren't on payroll and don't
    // get a team-lead bonus, so their eligible counts must NOT inflate Izaan's
    // payout. Pre-multi-office this filter wasn't needed because there was
    // only one Etsy team.
    const izaan = await prisma.user.findFirst({
      where: { employeeId: "EM-4" },
      select: { id: true, departmentId: true },
    });
    if (izaan) {
      const allEligible = await prisma.bonusEligibility.findMany({
        where: {
          month: parsed.month,
          year: parsed.year,
          isEligible: true,
          user: { departmentId: izaan.departmentId },
        },
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

        // WhatsApp removed — only fines & salary paid get notifications
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
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
