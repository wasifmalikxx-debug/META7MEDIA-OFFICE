import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { fetchSheetAnalytics } from "@/lib/services/google-sheets.service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/sheets-investigate?month=3&year=2026&employees=EM-2,EM-3,EM-6,EM-7
 * Deep investigation — returns ALL order rows for specified employees
 */
export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") return error("CEO only", 403);

  const url = new URL(request.url);
  const month = parseInt(url.searchParams.get("month") || "3");
  const year = parseInt(url.searchParams.get("year") || "2026");
  const employeeIds = (url.searchParams.get("employees") || "").split(",").map(s => s.trim()).filter(Boolean);

  if (employeeIds.length === 0) return error("Provide ?employees=EM-2,EM-3", 400);

  try {
    const employees = await prisma.user.findMany({
      where: {
        employeeId: { in: employeeIds },
        googleSheetUrl: { not: null },
      },
      select: { id: true, employeeId: true, firstName: true, lastName: true, googleSheetUrl: true },
      orderBy: { employeeId: "asc" },
    });

    const results: any[] = [];

    for (const emp of employees) {
      const name = `${emp.firstName} ${emp.lastName || ""}`.trim();
      const data = await fetchSheetAnalytics(emp.googleSheetUrl!, month, year);

      if (data.error) {
        results.push({ employeeId: emp.employeeId, name, error: data.error, orders: [], flags: [] });
        continue;
      }

      const orders = data.orders;
      const flags: any[] = [];

      // === EXACT DUPLICATES ===
      const exactMap = new Map<string, number[]>();
      orders.forEach((o, i) => {
        const key = `${o.shopName}|${o.orderDate}|${o.price}|${o.afterTax}|${o.cost}|${o.profit}`;
        const arr = exactMap.get(key) || [];
        arr.push(i + 2);
        exactMap.set(key, arr);
      });
      for (const [key, rows] of exactMap) {
        if (rows.length > 1) {
          const p = key.split("|");
          flags.push({
            severity: "CRITICAL",
            type: "EXACT_DUPLICATE",
            message: `DUPLICATE: "${p[0]}" on ${p[1]} — Price:$${p[2]} AfterTax:$${p[3]} Cost:$${p[4]} Profit:$${p[5]} — appears ${rows.length}x`,
            rows,
            extraProfit: parseFloat(p[5]) * (rows.length - 1),
          });
        }
      }

      // === NEAR DUPLICATES (same shop+date+price, different cost/profit — manual edit?) ===
      const nearMap = new Map<string, { rows: number[]; entries: any[] }>();
      orders.forEach((o, i) => {
        const key = `${o.shopName.toUpperCase()}|${o.orderDate}|${o.price}`;
        const existing = nearMap.get(key) || { rows: [], entries: [] };
        existing.rows.push(i + 2);
        existing.entries.push(o);
        nearMap.set(key, existing);
      });
      for (const [key, { rows, entries }] of nearMap) {
        if (rows.length > 1) {
          // Check if cost/profit differ between entries (sign of manual tampering)
          const profits = entries.map((e: any) => e.profit);
          const costs = entries.map((e: any) => e.cost);
          const allSameProfit = profits.every((p: number) => p === profits[0]);
          const allSameCost = costs.every((c: number) => c === costs[0]);
          if (!allSameProfit || !allSameCost) {
            const p = key.split("|");
            flags.push({
              severity: "HIGH",
              type: "NEAR_DUPLICATE_EDITED",
              message: `Same order "${p[0]}" on ${p[1]} at $${p[2]} but DIFFERENT cost/profit values — possible manual edit`,
              rows,
              details: entries.map((e: any, idx: number) => ({
                row: rows[idx],
                cost: e.cost,
                afterTax: e.afterTax,
                profit: e.profit,
              })),
            });
          }
        }
      }

      // === ROUND NUMBER PROFITS (manually typed?) ===
      const roundProfitRows: any[] = [];
      orders.forEach((o, i) => {
        if (o.profit > 0 && o.profit === Math.round(o.profit) && o.profit >= 10) {
          roundProfitRows.push({ row: i + 2, shop: o.shopName, date: o.orderDate, profit: o.profit, price: o.price, cost: o.cost });
        }
      });
      if (roundProfitRows.length >= 5) {
        flags.push({
          severity: "MEDIUM",
          type: "ROUND_NUMBERS",
          message: `${roundProfitRows.length} orders have perfectly round profit values (e.g. $10, $20, $50) — could indicate manual entry`,
          count: roundProfitRows.length,
          examples: roundProfitRows.slice(0, 10),
        });
      }

      // === SEQUENTIAL IDENTICAL ENTRIES (copy-paste block) ===
      for (let i = 0; i < orders.length - 1; i++) {
        let streak = 1;
        while (
          i + streak < orders.length &&
          orders[i].shopName === orders[i + streak].shopName &&
          orders[i].price === orders[i + streak].price &&
          orders[i].profit === orders[i + streak].profit &&
          orders[i].cost === orders[i + streak].cost
        ) {
          streak++;
        }
        if (streak >= 3) {
          flags.push({
            severity: "HIGH",
            type: "COPY_PASTE_BLOCK",
            message: `${streak} consecutive identical rows: "${orders[i].shopName}" — Price:$${orders[i].price} Profit:$${orders[i].profit}`,
            rows: Array.from({ length: streak }, (_, k) => i + k + 2),
            startRow: i + 2,
            endRow: i + streak + 1,
          });
          i += streak - 1; // skip past this block
        }
      }

      // === IMPOSSIBLE MARGINS ===
      orders.forEach((o, i) => {
        if (o.price > 0 && o.profit > o.price) {
          flags.push({
            severity: "HIGH",
            type: "IMPOSSIBLE_MARGIN",
            message: `Row ${i + 2}: "${o.shopName}" on ${o.orderDate} — Profit ($${o.profit}) > Price ($${o.price})`,
            rows: [i + 2],
          });
        }
      });

      // === PROFIT CONCENTRATION (one shop = most of the profit) ===
      const shopProfit = new Map<string, { total: number; count: number }>();
      let totalProfit = 0;
      orders.forEach((o) => {
        const shop = o.shopName.toUpperCase();
        const existing = shopProfit.get(shop) || { total: 0, count: 0 };
        existing.total += o.profit;
        existing.count++;
        shopProfit.set(shop, existing);
        totalProfit += o.profit;
      });

      // === SUMMARY MISMATCH ===
      const rowSum = orders.reduce((s, o) => s + o.afterTax, 0);
      const sheetVal = data.summary.afterTax;
      if (Math.abs(sheetVal - rowSum) > 1) {
        flags.push({
          severity: "INFO",
          type: "SUMMARY_MISMATCH",
          message: `Sheet AFTER TAX: $${sheetVal.toFixed(2)} vs Row sum: $${rowSum.toFixed(2)} (diff: $${Math.abs(sheetVal - rowSum).toFixed(2)})`,
          sheetValue: sheetVal,
          rowSum: Math.round(rowSum * 100) / 100,
        });
      }

      // Build shop breakdown
      const shopBreakdown = Array.from(shopProfit.entries())
        .map(([shop, { total, count }]) => ({
          shop,
          orders: count,
          totalProfit: Math.round(total * 100) / 100,
          pctOfTotal: totalProfit > 0 ? Math.round((total / totalProfit) * 100) : 0,
        }))
        .sort((a, b) => b.totalProfit - a.totalProfit);

      // Compute total extra profit from duplicates
      const extraProfitFromDupes = flags
        .filter((f) => f.type === "EXACT_DUPLICATE")
        .reduce((s, f) => s + (f.extraProfit || 0), 0);

      results.push({
        employeeId: emp.employeeId,
        name,
        tabName: data.tabName,
        totalOrders: orders.length,
        totalProfit: Math.round(totalProfit * 100) / 100,
        sheetAfterTax: sheetVal,
        shopBreakdown,
        flags,
        extraProfitFromDuplicates: Math.round(extraProfitFromDupes * 100) / 100,
        allOrders: orders.map((o, i) => ({ row: i + 2, ...o })),
      });
    }

    return json({ month, year, investigations: results });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
