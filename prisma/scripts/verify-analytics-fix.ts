/**
 * Verifies the analytics fix end-to-end by calling fetchSheetAnalytics()
 * (now post-fix) directly and running the same aggregation logic the API
 * uses. Prints per-employee totals so we can spot-check against the
 * pre-fix audit's "CORRECT" numbers.
 *
 * Run:  npx tsx prisma/scripts/verify-analytics-fix.ts
 *       MONTH=4 YEAR=2026 npx tsx prisma/scripts/verify-analytics-fix.ts
 */

import { prisma } from "../../src/lib/prisma";
import {
  fetchAllSheetAnalytics,
  type SheetOrderRow,
} from "../../src/lib/services/google-sheets.service";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pktNow = new Date(Date.now() + 5 * 60 * 60_000);
const MONTH = parseInt(process.env.MONTH || String(pktNow.getUTCMonth() + 1));
const YEAR = parseInt(process.env.YEAR || String(pktNow.getUTCFullYear()));

async function main() {
  const employees = await prisma.user.findMany({
    where: {
      status: { in: ["HIRED", "PROBATION"] },
      googleSheetUrl: { not: null },
      department: { name: { in: ["Etsy - EM", "Etsy - AE", "Etsy - ME"] } },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      googleSheetUrl: true,
      department: { select: { name: true } },
    },
    orderBy: [{ department: { name: "asc" } }, { employeeId: "asc" }],
  });

  console.log(
    `\nVerifying analytics output post-fix — ${MONTH}/${YEAR} — ${employees.length} employees\n`,
  );

  const sheets = employees.map((e) => ({
    userId: e.id,
    sheetUrl: e.googleSheetUrl!,
  }));
  const sheetData = await fetchAllSheetAnalytics(sheets, MONTH, YEAR);

  type Row = {
    emp: string;
    team: string;
    orders: number;
    sales: number;
    cost: number;
    grossProfit: number;
    error: string | null;
  };

  const byTeam: Record<string, Row[]> = {};

  for (const emp of employees) {
    const data = sheetData[emp.id];
    if (!data) continue;
    const team = emp.department?.name || "Unknown";
    const empStr = `${emp.employeeId} ${emp.firstName} ${emp.lastName || ""}`.trim();

    // Mirror exactly what the API does now.
    let totalSales = 0;
    let totalCost = 0;
    const seen = new Set<string>();
    let orders = 0;
    for (const o of data.orders) {
      totalSales += o.price;
      totalCost += o.cost;
      if (!o.orderId || !seen.has(o.orderId)) {
        orders++;
        if (o.orderId) seen.add(o.orderId);
      }
    }
    const grossProfit = totalSales - totalCost;

    const row: Row = {
      emp: empStr,
      team,
      orders,
      sales: totalSales,
      cost: totalCost,
      grossProfit,
      error: data.error,
    };
    byTeam[team] = byTeam[team] || [];
    byTeam[team].push(row);
  }

  // Per-employee output
  for (const [team, rows] of Object.entries(byTeam)) {
    console.log(`\n${team}`);
    console.log("─".repeat(team.length));
    for (const r of rows) {
      const flag = r.error ? ` ⚠ ${r.error}` : "";
      console.log(
        `  ${r.emp.padEnd(30)} ${String(r.orders).padStart(3)} orders  ` +
          `$${r.sales.toFixed(2).padStart(10)} sale  ` +
          `$${r.cost.toFixed(2).padStart(10)} cost  ` +
          `$${r.grossProfit.toFixed(2).padStart(10)} gross profit${flag}`,
      );
    }
    const tOrd = rows.reduce((s, r) => s + r.orders, 0);
    const tSale = rows.reduce((s, r) => s + r.sales, 0);
    const tCost = rows.reduce((s, r) => s + r.cost, 0);
    const tGP = rows.reduce((s, r) => s + r.grossProfit, 0);
    console.log(
      `  ${"TOTAL".padEnd(30)} ${String(tOrd).padStart(3)} orders  ` +
        `$${tSale.toFixed(2).padStart(10)} sale  ` +
        `$${tCost.toFixed(2).padStart(10)} cost  ` +
        `$${tGP.toFixed(2).padStart(10)} gross profit`,
    );
  }

  console.log("\nDone.\n");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Verify failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
