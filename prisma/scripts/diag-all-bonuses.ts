/**
 * Fleet-wide bonus diagnostic — read every Etsy employee's sheet for
 * the current month, compute the EXPECTED bonus (per the locked-in
 * AFTER-TAX rule, see memory/feedback_profit_rules.md), and compare
 * against the stored value in bonusEligibility + incentive.
 *
 * Prints a per-employee table showing:
 *   - EmpID + name
 *   - Σ Sale, Σ Cost, Σ AfterTax (fresh from sheet)
 *   - Stored totalProfit + bonusAmount
 *   - Expected totalProfit (= Σ AfterTax) + expected bonusAmount
 *   - Match / mismatch indicator
 *
 * Use this to verify the bonus pipeline is working correctly and
 * identify employees whose stored bonus is stale.
 *
 *   npx tsx prisma/scripts/diag-all-bonuses.ts
 */

import { PrismaClient } from "@prisma/client";
import { fetchSheetAnalytics } from "../../src/lib/services/google-sheets.service";
import { calculateEligibility } from "../../src/lib/services/bonus.service";

const prisma = new PrismaClient();

async function main() {
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = pkt.getUTCMonth() + 1;
  const year = pkt.getUTCFullYear();

  console.log(`FLEET BONUS AUDIT — ${month}/${year} (PKT)`);
  console.log("═".repeat(120));
  console.log("Rule: bonus input = AFTER TAX (memory/feedback_profit_rules.md)");
  console.log("Tier: floor(profit/500) × PKR 5,000 (min $1,000 profit to qualify)");
  console.log("");

  // Get all Etsy employees with sheets (same filter as sync-profits cron)
  const etsyDepts = await prisma.department.findMany({
    where: { name: { startsWith: "Etsy" } },
    select: { id: true, name: true },
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
      employeeId: true,
      firstName: true,
      lastName: true,
      googleSheetUrl: true,
      department: { select: { name: true } },
    },
    orderBy: { employeeId: "asc" },
  });

  console.log(
    "Emp".padEnd(7) +
      " | " +
      "Name".padEnd(20) +
      " | " +
      "Sale".padStart(10) +
      " | " +
      "Cost".padStart(10) +
      " | " +
      "AfterTax".padStart(10) +
      " | " +
      "StoredProfit".padStart(13) +
      " | " +
      "StoredBon".padStart(10) +
      " | " +
      "ExpectBon".padStart(10) +
      " | OK",
  );
  console.log("─".repeat(120));

  let mismatches = 0;
  let total = 0;

  for (const emp of employees) {
    if (!emp.googleSheetUrl) continue;
    total++;

    const data = await fetchSheetAnalytics(emp.googleSheetUrl, month, year);
    if (data.error) {
      console.log(
        `${(emp.employeeId || "?").padEnd(7)} | ${(emp.firstName + " " + (emp.lastName || "")).padEnd(20).slice(0, 20)} | ERR: ${data.error}`,
      );
      continue;
    }

    let sale = 0,
      cost = 0,
      afterTax = 0;
    for (const o of data.orders) {
      sale += o.price;
      cost += o.cost;
      afterTax += o.afterTax;
    }

    const elig = await prisma.bonusEligibility.findFirst({
      where: { userId: emp.id, month, year },
    });
    const profitBonusInc = await prisma.incentive.findFirst({
      where: { userId: emp.id, month, year, reason: { startsWith: "Profit Bonus" } },
    });

    const storedProfit = elig?.totalProfit ?? 0;
    const storedBon = profitBonusInc?.amount ?? 0;

    // Expected: per current rule, profit input = AFTER TAX, all booleans true (assume sync would refresh them)
    const expected = calculateEligibility({
      dailyListingsComplete: elig?.dailyListingsComplete ?? true,
      ordersProcessedSameDay: elig?.ordersProcessedSameDay ?? true,
      messagesCleared: elig?.messagesCleared ?? true,
      zeroWrongOrders: elig?.zeroWrongOrders ?? true,
      listingsRemovedCount: elig?.listingsRemovedCount ?? 0,
      allStoresAbove4Stars: elig?.allStoresAbove4Stars ?? true,
      totalProfit: afterTax,
    });
    const expectedBon = expected.bonusAmountPKR;

    // Mismatch = stored bonus differs from expected by > PKR 5,000 (one tier of drift = stale sync,
    // anything bigger = wrong formula or wrong input)
    const drift = Math.abs(storedBon - expectedBon);
    const ok = drift <= 5_000;
    if (!ok) mismatches++;

    const fmt = (n: number) => `$${n.toFixed(0)}`;
    console.log(
      `${(emp.employeeId || "?").padEnd(7)} | ${(emp.firstName + " " + (emp.lastName || "")).padEnd(20).slice(0, 20)} | ${fmt(sale).padStart(10)} | ${fmt(cost).padStart(10)} | ${fmt(afterTax).padStart(10)} | ${fmt(storedProfit).padStart(13)} | ${storedBon.toLocaleString().padStart(10)} | ${expectedBon.toLocaleString().padStart(10)} | ${ok ? "✓" : "✗"}`,
    );
  }

  console.log("");
  console.log("─".repeat(120));
  console.log(`Checked: ${total} employees`);
  console.log(`Mismatches (>1 tier drift): ${mismatches}`);
  if (mismatches > 0) {
    console.log("");
    console.log(
      "To refresh stale rows, hit the sync cron: curl http://localhost:3000/api/cron/sync-profits",
    );
    console.log("(in prod: triggered hourly by Vercel Cron)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
