/**
 * Analytics accuracy audit.
 *
 * For every Etsy employee (EM / AE / ME teams), pulls their raw sheet data
 * for the requested month and computes their per-employee totals in TWO
 * ways:
 *
 *   1. "Analytics-style" — the same logic /api/etsy-analytics uses today.
 *      Reads A:J, takes headers from row 0, counts every non-empty row as
 *      one order, sums the sheet's literal PROFIT column (which is actually
 *      after-tax-cost, NOT gross profit), prefers V:AD summary cells when
 *      present.
 *
 *   2. "Correct" — the same logic the daily-report cron has been hardened
 *      to use. Scans first 5 rows for the header (handles AE-3's Google
 *      Tables prefix), detects the Order ID column for multi-SKU dedup,
 *      skips empty-price placeholder rows, computes gross profit as
 *      sale - cost (NOT the PROFIT column).
 *
 * Then prints a per-employee diff so we can see exactly where the analytics
 * page is wrong, and a per-team rollup of how badly the numbers are off.
 *
 * Run with:
 *   npx tsx prisma/scripts/audit-analytics-accuracy.ts
 *   MONTH=4 YEAR=2026 npx tsx prisma/scripts/audit-analytics-accuracy.ts
 */

import { prisma } from "../../src/lib/prisma";
import { google } from "googleapis";
import {
  extractSheetId,
  getAlternativeTabNames,
  normalizeTabName,
} from "../../src/lib/services/google-sheets.service";
import path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Default to current PKT month/year; override via env.
const pktNow = new Date(Date.now() + 5 * 60 * 60_000);
const MONTH = parseInt(process.env.MONTH || String(pktNow.getUTCMonth() + 1));
const YEAR = parseInt(process.env.YEAR || String(pktNow.getUTCFullYear()));

function parseDollar(v: any): number {
  if (v == null) return 0;
  const s = String(v).replace(/[$,\s]/g, "").trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

async function getAuthClient() {
  if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    return auth.getClient();
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), "google-credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return auth.getClient();
}

interface EmpReport {
  emp: string;
  team: string;
  tab: string;
  headerRow: number; // 0-indexed
  cols: {
    shop: number;
    date: number;
    price: number;
    cost: number;
    profit: number;
    orderId: number;
  };
  // What the analytics route would compute today
  buggy: {
    orders: number;
    sale: number;
    cost: number;
    profitCol: number; // sum of PROFIT column (after-tax-cost, NOT gross)
  };
  // What the analytics route SHOULD compute
  correct: {
    orders: number; // deduped by Order ID
    rows: number; // raw filtered row count (kept for line-item totals)
    sale: number;
    cost: number;
    grossProfit: number;
  };
  // Summary cells from V:AD
  summary: {
    totalSale?: number;
    totalCost?: number;
    grossProfit?: number;
    afterTax?: number;
  };
  notes: string[];
}

async function auditOne(
  emp: {
    id: string;
    firstName: string;
    lastName: string | null;
    employeeId: string;
    googleSheetUrl: string;
    department: { name: string } | null;
  },
  sheets: any,
): Promise<EmpReport | { error: string; emp: string; team: string }> {
  const team = emp.department?.name || "Unknown";
  const empStr = `${emp.employeeId} ${emp.firstName} ${emp.lastName || ""}`.trim();

  const sheetId = extractSheetId(emp.googleSheetUrl);
  if (!sheetId) return { error: "invalid sheet URL", emp: empStr, team };

  try {
    // 1. Resolve the right tab.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tabs = meta.data.sheets?.map((s: any) => s.properties?.title || "") || [];
    const candidateSet = new Set(
      getAlternativeTabNames(MONTH, YEAR).map(normalizeTabName),
    );
    const matchedTab = tabs.find((t: string) => candidateSet.has(normalizeTabName(t)));
    if (!matchedTab) {
      return {
        error: `no tab for ${MONTH}/${YEAR}. Found: ${tabs.join(" | ")}`,
        emp: empStr,
        team,
      };
    }

    // 2. Pull rows (A:N to be safe, V:AD for summary). A:N matches what
    //    the daily-report cron does so we capture the Order ID col even
    //    on Shape B sheets where it lives past J.
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: [`'${matchedTab}'!A1:N1000`, `'${matchedTab}'!V1:AD15`],
    });
    const orderRows: string[][] = batch.data.valueRanges?.[0]?.values || [];
    const analyticsRows: string[][] = batch.data.valueRanges?.[1]?.values || [];

    const notes: string[] = [];

    // 3. Scan first 5 rows for the actual header (AE-3 has Table1_3 at A1).
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(5, orderRows.length); i++) {
      const row = (orderRows[i] || []).map((c) =>
        (c || "").toString().toLowerCase().trim(),
      );
      if (row.some((c) => c.includes("order date") || c === "date")) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) {
      return { error: "no header row in first 5 rows", emp: empStr, team };
    }
    if (headerRowIdx > 0) {
      notes.push(`Header at row ${headerRowIdx + 1} (analytics reads row 1 → would miss data)`);
    }

    const headers = (orderRows[headerRowIdx] || []).map((h) =>
      (h || "").toString().toLowerCase().trim(),
    );

    const shopCol = headers.findIndex(
      (h) => h.includes("shop") || h.includes("store"),
    );
    const dateCol = headers.findIndex(
      (h) => h.includes("order date") || h.includes("date"),
    );
    const priceCol = headers.findIndex(
      (h) => h.includes("price") || h.includes("sale"),
    );
    const costCol = headers.findIndex((h) => h === "cost" || h.includes("cost"));
    const profitCol = headers.findIndex(
      (h) => h === "profit" || h.includes("profit"),
    );
    const orderIdCol = headers.findIndex(
      (h) =>
        h.includes("order number") ||
        h.includes("order #") ||
        h.includes("ordder #") ||
        h.includes("order id") ||
        h === "ae order",
    );

    if (orderIdCol === -1) {
      notes.push("No Order ID column — multi-SKU dedup not possible");
    }
    if (profitCol === -1) {
      notes.push("No PROFIT column header — analytics fallback index would be wrong");
    }
    if (profitCol > 9) {
      notes.push(`PROFIT column at index ${profitCol} (past J) — analytics A:J range would miss it`);
    }

    // 4. Walk data rows and compute both flavors.
    const dataRows = orderRows.slice(headerRowIdx + 1);

    // Buggy = mirrors the analytics route's current logic
    let buggyRows = 0;
    let buggySale = 0;
    let buggyCost = 0;
    let buggyProfitCol = 0;

    // Correct = mirrors the daily-report cron's hardened logic
    let correctRows = 0;
    let correctSale = 0;
    let correctCost = 0;
    const seenOrderIds = new Set<string>();
    let uniqueOrders = 0;
    let emptyPriceCount = 0;

    for (const row of dataRows) {
      const shopName = shopCol >= 0 ? (row[shopCol] || "").toString().trim() : "";
      const dateVal = dateCol >= 0 ? (row[dateCol] || "").toString().trim() : "";
      const rowSale = priceCol >= 0 ? parseDollar(row[priceCol]) : 0;
      const rowCost = costCol >= 0 ? parseDollar(row[costCol]) : 0;
      const rowProfit = profitCol >= 0 ? parseDollar(row[profitCol]) : 0;
      const orderId = orderIdCol >= 0 ? (row[orderIdCol] || "").toString().trim() : "";

      // ─── Buggy logic (analytics route as-is) ───────────────────────
      // Skips rows missing shop or date, and rows shorter than 5 cells.
      // Counts EVERY remaining row as an order. Sums all amounts.
      if (shopName && dateVal && row.length >= 5) {
        // The route also drops any row whose shopName "includes" SHOP or
        // STORE NAME (mistaken header-detection) — but we'll be lenient
        // here and only drop the exact-match case so we don't double-
        // penalize names like "ShopMyDecor".
        const upper = shopName.toUpperCase();
        const isHeaderLike = upper === "SHOP" || upper === "STORE" || upper.includes("STORE NAME");
        if (!isHeaderLike) {
          buggyRows++;
          buggySale += rowSale;
          buggyCost += rowCost;
          buggyProfitCol += rowProfit;
        }
      }

      // ─── Correct logic (daily-report cron) ─────────────────────────
      if (!dateVal) continue;
      if (rowSale <= 0) {
        emptyPriceCount++;
        continue;
      }
      correctRows++;
      correctSale += rowSale;
      correctCost += rowCost;

      // Dedupe by Order ID — multi-SKU line items belong to one order.
      if (!orderId || !seenOrderIds.has(orderId)) {
        uniqueOrders++;
        if (orderId) seenOrderIds.add(orderId);
      }
    }

    if (emptyPriceCount > 0) {
      notes.push(`${emptyPriceCount} empty-price rows (analytics would count these as orders)`);
    }
    const dupRows = correctRows - uniqueOrders;
    if (dupRows > 0) {
      notes.push(`${dupRows} multi-SKU duplicate rows (analytics would overcount orders by ${dupRows})`);
    }

    // 5. Summary cells from V:AD
    const summary: EmpReport["summary"] = {};
    const labelMap: Record<string, keyof EmpReport["summary"]> = {
      "TOTAL SALE": "totalSale",
      "TOTAL SALES": "totalSale",
      "TOTAL COST": "totalCost",
      "GROSS PROFIT": "grossProfit",
      "AFTER TAX": "afterTax",
    };
    for (const row of analyticsRows) {
      for (let c = 0; c < (row?.length || 0); c++) {
        const v = String(row[c] || "")
          .trim()
          .toUpperCase();
        const key = labelMap[v];
        if (key) {
          const num = parseDollar(row[c + 1]);
          if (num) summary[key] = num;
        }
      }
    }

    const correctGrossProfit = correctSale - correctCost;
    if (
      summary.grossProfit &&
      Math.abs(summary.grossProfit - correctGrossProfit) > 1
    ) {
      notes.push(
        `Sheet's GROSS PROFIT cell ($${summary.grossProfit.toFixed(2)}) differs from sale-cost ($${correctGrossProfit.toFixed(2)}) by $${(summary.grossProfit - correctGrossProfit).toFixed(2)}`,
      );
    }
    if (summary.totalSale && Math.abs(summary.totalSale - correctSale) > 1) {
      notes.push(
        `Sheet's TOTAL SALE cell ($${summary.totalSale.toFixed(2)}) differs from row sum ($${correctSale.toFixed(2)})`,
      );
    }

    return {
      emp: empStr,
      team,
      tab: matchedTab,
      headerRow: headerRowIdx,
      cols: {
        shop: shopCol,
        date: dateCol,
        price: priceCol,
        cost: costCol,
        profit: profitCol,
        orderId: orderIdCol,
      },
      buggy: {
        orders: buggyRows,
        sale: buggySale,
        cost: buggyCost,
        profitCol: buggyProfitCol,
      },
      correct: {
        orders: uniqueOrders,
        rows: correctRows,
        sale: correctSale,
        cost: correctCost,
        grossProfit: correctGrossProfit,
      },
      summary,
      notes,
    };
  } catch (err: any) {
    return { error: err.message || String(err), emp: empStr, team };
  }
}

async function audit() {
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
    `\n══════════════════════════════════════════════════════════════════════`,
  );
  console.log(
    `   ANALYTICS ACCURACY AUDIT — ${MONTH}/${YEAR}`,
  );
  console.log(
    `══════════════════════════════════════════════════════════════════════`,
  );
  console.log(
    `Auditing ${employees.length} Etsy employees across EM / AE / ME teams.`,
  );
  console.log(`(Computing each employee two ways and diffing.)\n`);

  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: "v4", auth: authClient as any });

  const allReports: EmpReport[] = [];
  const errors: { emp: string; team: string; error: string }[] = [];

  // Process 3 at a time to stay friendly to the sheets API rate limit.
  const BATCH = 3;
  for (let i = 0; i < employees.length; i += BATCH) {
    const batch = employees.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((emp) =>
        auditOne(
          { ...emp, googleSheetUrl: emp.googleSheetUrl! },
          sheets,
        ),
      ),
    );
    for (const r of results) {
      if ("error" in r) {
        errors.push(r);
      } else {
        allReports.push(r);
      }
    }
  }

  // ─── Per-employee output ────────────────────────────────────────────
  const byTeam: Record<string, EmpReport[]> = {};
  for (const r of allReports) {
    byTeam[r.team] = byTeam[r.team] || [];
    byTeam[r.team].push(r);
  }

  for (const [team, reports] of Object.entries(byTeam)) {
    console.log(`\n┌─ ${team} ─────────────────────────────────────────────────`);
    for (const r of reports) {
      const sale = r.correct.sale.toFixed(2);
      const cost = r.correct.cost.toFixed(2);
      const gp = r.correct.grossProfit.toFixed(2);

      console.log(`│`);
      console.log(`│ ${r.emp}`);
      console.log(
        `│   Tab "${r.tab}" · header row ${r.headerRow + 1} · ` +
          `cols [shop=${r.cols.shop} date=${r.cols.date} price=${r.cols.price} ` +
          `cost=${r.cols.cost} profit=${r.cols.profit} orderId=${r.cols.orderId}]`,
      );
      console.log(
        `│   CORRECT:  ${String(r.correct.orders).padStart(3)} orders · $${sale.padStart(10)} sale · $${cost.padStart(10)} cost · $${gp.padStart(10)} gross profit`,
      );
      console.log(
        `│   ANALYTICS:${String(r.buggy.orders).padStart(3)} orders · $${r.buggy.sale.toFixed(2).padStart(10)} sale · $${r.buggy.cost.toFixed(2).padStart(10)} cost · (uses sheet's PROFIT col: $${r.buggy.profitCol.toFixed(2)})`,
      );

      // Diff line — only if there's something to flag.
      const orderDelta = r.buggy.orders - r.correct.orders;
      const saleDelta = r.buggy.sale - r.correct.sale;
      const profitDelta = r.buggy.profitCol - r.correct.grossProfit;
      const issues: string[] = [];
      if (orderDelta !== 0)
        issues.push(`orders ${orderDelta > 0 ? "+" : ""}${orderDelta}`);
      if (Math.abs(saleDelta) > 0.01)
        issues.push(`sale ${saleDelta > 0 ? "+" : ""}$${saleDelta.toFixed(2)}`);
      if (Math.abs(profitDelta) > 1)
        issues.push(
          `profit shown $${r.buggy.profitCol.toFixed(2)} vs gross $${gp} (Δ $${profitDelta.toFixed(2)})`,
        );
      if (issues.length > 0) {
        console.log(`│   ⚠ DIFF: ${issues.join(" · ")}`);
      } else {
        console.log(`│   ✓ matches`);
      }
      if (r.notes.length > 0) {
        for (const note of r.notes) {
          console.log(`│   · ${note}`);
        }
      }
    }
    console.log(`└──────────────────────────────────────────────────────────────`);
  }

  // ─── Per-team rollup ────────────────────────────────────────────────
  console.log(
    `\n══════════════════════════════════════════════════════════════════════`,
  );
  console.log(`   TEAM ROLLUP`);
  console.log(
    `══════════════════════════════════════════════════════════════════════`,
  );
  for (const [team, reports] of Object.entries(byTeam)) {
    const buggyOrd = reports.reduce((s, r) => s + r.buggy.orders, 0);
    const buggySale = reports.reduce((s, r) => s + r.buggy.sale, 0);
    const buggyProfit = reports.reduce((s, r) => s + r.buggy.profitCol, 0);

    const correctOrd = reports.reduce((s, r) => s + r.correct.orders, 0);
    const correctSale = reports.reduce((s, r) => s + r.correct.sale, 0);
    const correctGP = reports.reduce((s, r) => s + r.correct.grossProfit, 0);

    const ordPct = correctOrd > 0
      ? ((buggyOrd - correctOrd) / correctOrd) * 100
      : 0;
    const salePct = correctSale > 0
      ? ((buggySale - correctSale) / correctSale) * 100
      : 0;
    const profitPct = correctGP > 0
      ? ((buggyProfit - correctGP) / correctGP) * 100
      : 0;

    console.log(`\n${team} (${reports.length} members)`);
    console.log(
      `  ANALYTICS says: ${String(buggyOrd).padStart(4)} orders · $${buggySale.toFixed(2).padStart(11)} sale · $${buggyProfit.toFixed(2).padStart(11)} "profit" (after-tax-cost)`,
    );
    console.log(
      `  CORRECT:        ${String(correctOrd).padStart(4)} orders · $${correctSale.toFixed(2).padStart(11)} sale · $${correctGP.toFixed(2).padStart(11)} gross profit`,
    );
    console.log(
      `  Δ orders:  ${(buggyOrd - correctOrd > 0 ? "+" : "")}${buggyOrd - correctOrd} (${ordPct > 0 ? "+" : ""}${ordPct.toFixed(1)}%) ${ordPct > 0 ? "[ANALYTICS OVERCOUNTS]" : ordPct < 0 ? "[ANALYTICS UNDERCOUNTS]" : ""}`,
    );
    console.log(
      `  Δ sale:    $${(buggySale - correctSale > 0 ? "+" : "")}${(buggySale - correctSale).toFixed(2)} (${salePct > 0 ? "+" : ""}${salePct.toFixed(1)}%) ${salePct > 0 ? "[ANALYTICS OVERSTATED]" : salePct < 0 ? "[ANALYTICS UNDERSTATED]" : ""}`,
    );
    console.log(
      `  Δ profit:  $${(buggyProfit - correctGP > 0 ? "+" : "")}${(buggyProfit - correctGP).toFixed(2)} (${profitPct > 0 ? "+" : ""}${profitPct.toFixed(1)}%) ${profitPct > 0 ? "[ANALYTICS OVERSTATED]" : profitPct < 0 ? "[ANALYTICS UNDERSTATED]" : ""}`,
    );
  }

  // ─── Errors ────────────────────────────────────────────────────────
  if (errors.length > 0) {
    console.log(
      `\n══════════════════════════════════════════════════════════════════════`,
    );
    console.log(`   ERRORS (could not audit ${errors.length} employees)`);
    console.log(
      `══════════════════════════════════════════════════════════════════════`,
    );
    for (const e of errors) {
      console.log(`✗ ${e.emp} (${e.team}): ${e.error}`);
    }
  }

  console.log(`\nDone.\n`);
  await prisma.$disconnect();
}

audit().catch((err) => {
  console.error("Audit failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
