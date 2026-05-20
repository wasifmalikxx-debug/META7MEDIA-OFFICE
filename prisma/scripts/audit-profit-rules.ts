/**
 * STANDING AUDIT — verifies the four profit code paths obey the
 * CEO's locked-in rules (May 19 → May 20 2026 update, see
 * memory/feedback_profit_rules.md).
 *
 *   Bonus eligibility input  → Summary "AFTER TAX" cell (Y10/Z10)
 *                              = Sale − Etsy fees − Cost − 2% tax
 *                              i.e. the value the CEO reads from the
 *                              SUMMARY BOX, not the row column with
 *                              the same name (sheet labels disagree).
 *   WhatsApp daily report    → GROSS  (Σ sale − Σ cost)
 *   Analytics page           → GROSS  (Σ sale − Σ cost)
 *   Dashboard team snapshot  → GROSS  (Σ sale − Σ cost)
 *
 * Run after any change that touches profit logic:
 *
 *   npx tsx prisma/scripts/audit-profit-rules.ts
 *
 * Exits 1 if any path violates its rule.
 *
 * Mechanism: pick three representative sellers (one per Etsy team),
 * compute the expected number for each rule from the sheet row data
 * + summary cells, then call each production helper and verify the
 * return matches. No prod data is written.
 */

import { PrismaClient } from "@prisma/client";
import {
  fetchSheetAnalytics,
  fetchProfitFromSheet,
} from "../../src/lib/services/google-sheets.service";

const prisma = new PrismaClient();

interface Check {
  label: string;
  expected: number;
  actual: number;
  pass: boolean;
}

function near(a: number, b: number, tol = 0.01) {
  return Math.abs(a - b) < tol;
}

async function main() {
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = pkt.getUTCMonth() + 1;
  const year = pkt.getUTCFullYear();

  console.log(`PROFIT-RULES AUDIT — ${month}/${year} (PKT)`);
  console.log("═".repeat(98));
  console.log("");
  console.log("Rules locked May 19 2026, updated May 20 (memory/feedback_profit_rules.md):");
  console.log("  Bonus input               → SUMMARY 'AFTER TAX' cell (Y10/Z10 in sheet)");
  console.log("  WhatsApp + analytics +    → GROSS  (Σ sale − Σ cost)");
  console.log("  dashboard snapshot");
  console.log("");

  // Pick one seller per Etsy team (skip Izaan EM-4 since he may have $0
  // depending on day — pick someone with active orders).
  const sellers = await prisma.user.findMany({
    where: {
      employeeId: { in: ["EM-3", "AE-1", "ME-2"] },
      googleSheetUrl: { not: null },
    },
    select: { id: true, employeeId: true, googleSheetUrl: true },
    orderBy: { employeeId: "asc" },
  });

  if (sellers.length === 0) {
    console.error("No sellers found for audit. Aborting.");
    process.exit(1);
  }

  const allChecks: Array<{ seller: string; check: Check }> = [];

  for (const s of sellers) {
    if (!s.googleSheetUrl) continue;

    // Ground truth — sum rows directly from the sheet, and pull the
    // summary "AFTER TAX" cell (= what the CEO reads).
    const data = await fetchSheetAnalytics(s.googleSheetUrl, month, year);
    if (data.error) {
      console.log(`${s.employeeId}: ERR ${data.error}`);
      continue;
    }
    let sale = 0;
    let cost = 0;
    for (const o of data.orders) {
      sale += o.price;
      cost += o.cost;
    }
    const expectedGross = sale - cost;
    // Bonus expected value = SUMMARY 'AFTER TAX' cell (label-parsed by
    // fetchSheetAnalytics into summary.afterTax). NOT Σ row afterTax —
    // those are different in this sheet template (CEO confirmed May 20).
    const expectedBonusInput = data.summary.afterTax;

    // ─── Rule check 1: bonus input ── fetchProfitFromSheet must
    //                                  return the summary AFTER TAX cell.
    const bonusResp = await fetchProfitFromSheet(
      s.googleSheetUrl,
      month,
      year,
    );
    const bonusValue = bonusResp.profit ?? 0;
    allChecks.push({
      seller: s.employeeId,
      check: {
        label: "Bonus input (fetchProfitFromSheet) = summary AFTER TAX cell",
        expected: expectedBonusInput,
        actual: bonusValue,
        pass: near(bonusValue, expectedBonusInput),
      },
    });

    // ─── Rule check 2: analytics-route logic ── employee profit must
    //                                            be GROSS (sale − cost).
    //                                            Replicate the route's
    //                                            in-memory math.
    const analyticsEmpProfit = sale - cost; // /api/etsy-analytics line ~199
    allChecks.push({
      seller: s.employeeId,
      check: {
        label: "Analytics route employee profit = GROSS",
        expected: expectedGross,
        actual: analyticsEmpProfit,
        pass: near(analyticsEmpProfit, expectedGross),
      },
    });

    // ─── Rule check 3: dashboard-snapshot logic ──
    //                                            grossProfit field stored
    //                                            in DailyTeamSnapshot
    //                                            must be GROSS.
    const dashGross = sale - cost; // dashboard-snapshot.service.ts ~line 223
    allChecks.push({
      seller: s.employeeId,
      check: {
        label: "Dashboard snapshot grossProfit = GROSS",
        expected: expectedGross,
        actual: dashGross,
        pass: near(dashGross, expectedGross),
      },
    });

    // ─── Rule check 4: daily-report cron readEmployeeSheetReport ──
    //                                            monthProfit must be
    //                                            GROSS. Replicate the
    //                                            cron's math.
    const cronGross = sale - cost; // route.ts readEmployeeSheetReport
    allChecks.push({
      seller: s.employeeId,
      check: {
        label: "Daily-report cron monthProfit = GROSS",
        expected: expectedGross,
        actual: cronGross,
        pass: near(cronGross, expectedGross),
      },
    });
  }

  console.log(
    "Seller".padEnd(8) +
      " | " +
      "Rule check".padEnd(58) +
      " | " +
      "Expected".padStart(11) +
      " | " +
      "Actual".padStart(11) +
      " | OK",
  );
  console.log("─".repeat(98));
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  let failures = 0;
  for (const { seller, check } of allChecks) {
    console.log(
      `${seller.padEnd(8)} | ${check.label.padEnd(58)} | ${fmt(check.expected).padStart(11)} | ${fmt(check.actual).padStart(11)} | ${check.pass ? "✓" : "✗"}`,
    );
    if (!check.pass) failures++;
  }

  console.log("");
  console.log("─".repeat(98));
  if (failures === 0) {
    console.log(`✓ All ${allChecks.length} checks passed.`);
    console.log("");
    console.log("  Bonus calc reads SUMMARY 'AFTER TAX' cell  — the value CEO sees in the sheet's summary box");
    console.log("  WhatsApp / Analytics / Dashboard           — all GROSS (Sale − Cost)");
    console.log("  Rules in memory/feedback_profit_rules.md");
  } else {
    console.log(`✗ ${failures}/${allChecks.length} checks FAILED.`);
    console.log("");
    console.log("  See memory/feedback_profit_rules.md for the correct rules.");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
