import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { fetchAllProfits } from "@/lib/services/google-sheets.service";
import { calculateEligibility } from "@/lib/services/bonus.service";

/**
 * Hourly cron job to sync profits from Google Sheets
 * and update bonus eligibility + incentive records.
 *
 * Can be triggered:
 * - By Vercel Cron (vercel.json)
 * - Manually via GET /api/cron/sync-profits
 */
export async function GET(request: NextRequest) {
  // Optional: verify cron secret for security
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Allow without secret in development
    if (process.env.NODE_ENV === "production") {
      return error("Unauthorized", 401);
    }
  }

  try {
    const now = nowPKT();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    // Get Etsy employees with sheets
    const etsyDept = await prisma.department.findFirst({ where: { name: "Etsy" } });
    if (!etsyDept) return json({ message: "No Etsy department found" });

    const employees = await prisma.user.findMany({
      where: {
        departmentId: etsyDept.id,
        status: { in: ["HIRED"] },
        googleSheetUrl: { not: null },
        // Exclusions:
        //  - EM-4  (Izaan, team lead — has his own team-lead bonus formula)
        //  - EM-4L (Abdullah, hired for non-Etsy ecom work — not in bonus program)
        employeeId: { notIn: ["EM-4", "EM-4L"] },
      },
      select: { id: true, firstName: true, lastName: true, employeeId: true, googleSheetUrl: true },
    });

    const employeeSheets = employees
      .filter((e) => e.googleSheetUrl)
      .map((e) => ({ userId: e.id, sheetUrl: e.googleSheetUrl! }));

    if (employeeSheets.length === 0) {
      return json({ message: "No employee sheets configured", synced: 0 });
    }

    // Fetch profits from all sheets
    const profits = await fetchAllProfits(employeeSheets, month, year);

    // Get admin user for givenById
    const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
    if (!admin) return error("No admin user found");

    let synced = 0;
    let errors = 0;
    const results: any[] = [];

    for (const emp of employees) {
      const profitData = profits[emp.id];
      if (!profitData || profitData.profit === null) {
        errors++;
        results.push({ employeeId: emp.employeeId, error: profitData?.error || "No data" });
        continue;
      }

      const profit = profitData.profit;

      // Get or create eligibility record
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

      // Upsert eligibility
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

      // Sync incentive records
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
        // Remove ONLY the profit bonus when not eligible.
        // Review bonuses are independent and must remain regardless of the
        // 7-criteria outcome — the only gate on review bonuses is PROBATION
        // status (enforced at approval time in /api/review-bonus/[id]).
        await prisma.incentive.deleteMany({
          where: { userId: emp.id, month, year, reason: { startsWith: "Profit Bonus" } },
        });
      }

      synced++;
      results.push({
        employeeId: emp.employeeId,
        name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
        profit,
        eligible: result.isEligible,
        bonus: result.bonusAmountPKR,
      });
    }

    // Sync Team Lead bonus for Izaan (EM-4): PKR 5,000 per eligible employee
    const izaan = await prisma.user.findFirst({ where: { employeeId: "EM-4" } });
    if (izaan) {
      const eligibleCount = results.filter((r: any) => r.eligible).length;
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
              month, year,
              givenById: admin.id,
            },
          });
        }
      } else if (existingTLBonus) {
        await prisma.incentive.delete({ where: { id: existingTLBonus.id } });
      }
    }

    return json({
      message: `Synced ${synced} employees, ${errors} errors`,
      timestamp: now.toISOString(),
      month,
      year,
      synced,
      errors,
      results,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
