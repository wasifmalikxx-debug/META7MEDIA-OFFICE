/**
 * Direct invocation of the sync-profits logic without going through HTTP.
 * Use this when the dev server isn't running but you want to refresh
 * bonusEligibility rows + Profit Bonus incentives for the current month.
 *
 * Mirrors src/app/api/cron/sync-profits/route.ts exactly — same query,
 * same calculateEligibility call, same incentive upsert/delete logic,
 * same team-lead bonus calc for Izaan.
 *
 *   npx tsx prisma/scripts/run-bonus-sync.ts
 *
 * After running, hit the same script's diagnostic sibling (diag-all-bonuses.ts)
 * to verify all rows are in sync.
 */

import { PrismaClient } from "@prisma/client";
import { fetchAllProfits } from "../../src/lib/services/google-sheets.service";
import { calculateEligibility } from "../../src/lib/services/bonus.service";

const prisma = new PrismaClient();

async function main() {
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = pkt.getUTCMonth() + 1;
  const year = pkt.getUTCFullYear();

  console.log(`BONUS SYNC — ${month}/${year} (PKT)`);
  console.log("Rule: bonus input = AFTER TAX (memory/feedback_profit_rules.md)\n");

  const etsyDepts = await prisma.department.findMany({
    where: { name: { startsWith: "Etsy" } },
    select: { id: true },
  });
  const etsyDeptIds = etsyDepts.map((d) => d.id);

  const employees = await prisma.user.findMany({
    where: {
      departmentId: { in: etsyDeptIds },
      status: { in: ["HIRED"] },
      googleSheetUrl: { not: null },
      employeeId: { notIn: ["EM-4L"] },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      googleSheetUrl: true,
      departmentId: true,
    },
    orderBy: { employeeId: "asc" },
  });

  const sheets = employees
    .filter((e) => e.googleSheetUrl)
    .map((e) => ({ userId: e.id, sheetUrl: e.googleSheetUrl! }));

  const profits = await fetchAllProfits(sheets, month, year);

  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!admin) throw new Error("No admin user");

  const results: any[] = [];
  let synced = 0;

  for (const emp of employees) {
    const profitData = profits[emp.id];
    if (!profitData || profitData.profit === null) {
      console.log(
        `${emp.employeeId?.padEnd(7)} ${(emp.firstName + " " + (emp.lastName || "")).padEnd(20)} SKIP: ${profitData?.error || "no data"}`,
      );
      continue;
    }
    const profit = profitData.profit;

    const existing = await prisma.bonusEligibility.findUnique({
      where: { userId_month_year: { userId: emp.id, month, year } },
    });

    const criteria = {
      dailyListingsComplete: existing?.dailyListingsComplete ?? true,
      ordersProcessedSameDay: existing?.ordersProcessedSameDay ?? true,
      messagesCleared: existing?.messagesCleared ?? true,
      zeroWrongOrders: existing?.zeroWrongOrders ?? true,
      listingsRemovedCount: existing?.listingsRemovedCount ?? 0,
      allStoresAbove4Stars: existing?.allStoresAbove4Stars ?? true,
      totalProfit: profit,
    };

    const result = calculateEligibility(criteria);

    await prisma.bonusEligibility.upsert({
      where: { userId_month_year: { userId: emp.id, month, year } },
      create: {
        userId: emp.id,
        month,
        year,
        ...criteria,
        isEligible: result.isEligible,
        bonusAmount: result.bonusAmountPKR,
        updatedById: admin.id,
      },
      update: {
        totalProfit: profit,
        isEligible: result.isEligible,
        bonusAmount: result.bonusAmountPKR,
        updatedById: admin.id,
      },
    });

    if (result.isEligible && result.bonusAmountPKR > 0) {
      const existingIncentive = await prisma.incentive.findFirst({
        where: { userId: emp.id, month, year, reason: { startsWith: "Profit Bonus" } },
      });
      if (existingIncentive) {
        if (existingIncentive.amount !== result.bonusAmountPKR) {
          await prisma.incentive.update({
            where: { id: existingIncentive.id },
            data: {
              amount: result.bonusAmountPKR,
              reason: `Profit Bonus - $${profit.toFixed(0)} profit → PKR ${result.bonusAmountPKR.toLocaleString()}`,
            },
          });
        }
      } else {
        await prisma.incentive.create({
          data: {
            userId: emp.id,
            type: "TARGET_BASED",
            amount: result.bonusAmountPKR,
            reason: `Profit Bonus - $${profit.toFixed(0)} profit → PKR ${result.bonusAmountPKR.toLocaleString()}`,
            month,
            year,
            givenById: admin.id,
          },
        });
      }
    } else {
      await prisma.incentive.deleteMany({
        where: { userId: emp.id, month, year, reason: { startsWith: "Profit Bonus" } },
      });
    }

    results.push({ ...emp, profit, eligible: result.isEligible, bonus: result.bonusAmountPKR });
    synced++;

    console.log(
      `${(emp.employeeId || "?").padEnd(7)} ${(emp.firstName + " " + (emp.lastName || "")).padEnd(20)} AFTER TAX=$${profit.toFixed(0).padStart(6)} → bonus PKR ${result.bonusAmountPKR.toLocaleString().padStart(7)} ${result.isEligible ? "✓" : "—"}`,
    );
  }

  // Izaan team-lead bonus — same logic as cron
  const izaan = await prisma.user.findFirst({
    where: { employeeId: "EM-4" },
    select: { id: true, departmentId: true },
  });
  if (izaan) {
    const eligibleCount = results.filter(
      (r: any) => r.eligible && r.departmentId === izaan.departmentId && r.employeeId !== "EM-4",
    ).length;
    const teamLeadBonus = eligibleCount * 5000;

    const existingTLBonus = await prisma.incentive.findFirst({
      where: { userId: izaan.id, month, year, reason: { startsWith: "Team Lead Bonus" } },
    });

    if (teamLeadBonus > 0) {
      if (existingTLBonus) {
        await prisma.incentive.update({
          where: { id: existingTLBonus.id },
          data: { amount: teamLeadBonus, reason: `Team Lead Bonus - ${eligibleCount} eligible employees × PKR 5,000` },
        });
      } else {
        await prisma.incentive.create({
          data: {
            userId: izaan.id,
            type: "TARGET_BASED",
            amount: teamLeadBonus,
            reason: `Team Lead Bonus - ${eligibleCount} eligible employees × PKR 5,000`,
            month,
            year,
            givenById: admin.id,
          },
        });
      }
    } else if (existingTLBonus) {
      await prisma.incentive.delete({ where: { id: existingTLBonus.id } });
    }
    console.log(`\nIzaan team-lead bonus: ${eligibleCount} eligible × PKR 5,000 = PKR ${teamLeadBonus.toLocaleString()}`);
  }

  console.log(`\n✓ Synced ${synced} employees.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
