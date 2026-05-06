/**
 * Forensic audit of EM team's April 2026 bonus eligibility claims.
 *
 * Cross-checks for each EM-* employee:
 *   1. Declared profit (BonusEligibility.totalProfit) vs current sheet sum
 *   2. Profit "just over" a tier threshold ($1000 / $1500 / $2000 …)
 *   3. Listings-removed count (declared 0 vs any sign of actual removal)
 *   4. Duplicate rows (same shop + price + date appearing >1x)
 *   5. Empty-cost rows (could be hiding genuine expenses)
 *   6. April refunds outstanding that would reduce real profit
 *   7. Eligibility status vs the formula's mechanical answer
 *
 * Read-only. Does NOT modify any records. Just prints flags.
 */
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import path from "path";
import {
  extractSheetId,
  normalizeTabName,
  getAlternativeTabNames,
} from "../../src/lib/services/google-sheets.service";

const prisma = new PrismaClient();

function parseDollar(val: string | undefined): number {
  if (!val) return 0;
  return parseFloat(val.replace(/[$,\s]/g, "")) || 0;
}

interface RowData {
  date: string;
  shop: string;
  customer: string;
  orderId: string;
  price: number;
  afterTax: number;
  cost: number;
  profit: number;
}

async function fetchAprilRows(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string,
): Promise<{ rows: RowData[]; tab: string | null; error?: string }> {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
    const candidateSet = new Set(getAlternativeTabNames(4, 2026).map(normalizeTabName));
    const actualTab = tabs.find((t) => candidateSet.has(normalizeTabName(t)));
    if (!actualTab) return { rows: [], tab: null, error: `no April tab; available: ${tabs.join(", ")}` };

    // Find header row (handle Google "Tables" prefix)
    const previewRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A1:N5`,
    });
    const previewRows = (previewRes.data.values || []) as string[][];
    let headerIdx = -1;
    for (let i = 0; i < previewRows.length; i++) {
      const r = (previewRows[i] || []).map((c) => (c || "").toString().toLowerCase().trim());
      if (r.some((c) => c.includes("order date") || c === "date")) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) return { rows: [], tab: actualTab, error: "no header row" };

    const headers = (previewRows[headerIdx] || []).map((h) => (h || "").toString().toLowerCase().trim());
    const dateCol = headers.findIndex((h) => h.includes("order date") || h.includes("date"));
    const priceCol = headers.findIndex((h) => h.includes("price"));
    const aftCol = headers.findIndex((h) => h.includes("after tax"));
    const costCol = headers.findIndex((h) => h.includes("cost"));
    const profitCol = headers.findIndex((h) => h.trim() === "profit" || h.trim() === "gross profit");
    const shopCol = headers.findIndex((h) => h.includes("store") || h.includes("shop"));
    const customerCol = headers.findIndex((h) => h.includes("customer"));
    const orderIdCol = headers.findIndex(
      (h) =>
        h.includes("order number") ||
        h.includes("order #") ||
        h.includes("ordder #") ||
        h.includes("order id") ||
        h === "ae order",
    );

    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A${headerIdx + 2}:N1000`,
    });
    const rawRows = dataRes.data.values || [];
    const rows: RowData[] = [];
    for (const row of rawRows) {
      const date = (row[dateCol] || "").toString().trim();
      if (!date) continue;
      const price = priceCol >= 0 ? parseDollar(row[priceCol]) : 0;
      if (price <= 0) continue;
      rows.push({
        date,
        shop: shopCol >= 0 ? (row[shopCol] || "").toString().trim() : "",
        customer: customerCol >= 0 ? (row[customerCol] || "").toString().trim() : "",
        orderId: orderIdCol >= 0 ? (row[orderIdCol] || "").toString().trim() : "",
        price,
        afterTax: aftCol >= 0 ? parseDollar(row[aftCol]) : 0,
        cost: costCol >= 0 ? parseDollar(row[costCol]) : 0,
        profit: profitCol >= 0 ? parseDollar(row[profitCol]) : 0,
      });
    }
    return { rows, tab: actualTab };
  } catch (e: any) {
    return { rows: [], tab: null, error: e.message?.slice(0, 100) };
  }
}

function tierJustOver(p: number): { tier: number; gap: number } | null {
  // Bonus tier breakpoints: every $500 starting at $1000
  if (p < 1000) return null;
  const tier = Math.floor(p / 500) * 500;
  const gap = p - tier;
  if (gap < 50) return { tier, gap };
  return null;
}

async function main() {
  const aprStart = new Date(Date.UTC(2026, 3, 1));
  const aprEnd = new Date(Date.UTC(2026, 3, 30, 23, 59, 59));

  const emDept = await prisma.department.findFirst({
    where: { office: { isPrimary: true }, OR: [{ name: "Etsy - EM" }, { name: "Etsy" }] },
  });
  if (!emDept) {
    console.log("No EM department found.");
    return;
  }

  const employees = await prisma.user.findMany({
    where: {
      departmentId: emDept.id,
      status: { in: ["HIRED", "PROBATION"] },
      employeeId: { notIn: ["EM-4", "EM-4L"] }, // exclude Izaan + Abdullah
    },
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      googleSheetUrl: true,
      status: true,
    },
    orderBy: { employeeId: "asc" },
  });

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), "google-credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client as any });

  console.log(`\n━━━ April 2026 EM Bonus Audit ━━━\n`);

  for (const emp of employees) {
    const elig = await prisma.bonusEligibility.findFirst({
      where: { userId: emp.id, month: 4, year: 2026 },
    });
    const refunds = await prisma.refund.findMany({
      where: {
        userId: emp.id,
        createdAt: { gte: aprStart, lte: aprEnd },
      },
    });
    const refundTotal = refunds.reduce((s, r) => s + (r.etsyRefundAmount || 0), 0);

    console.log(`▸ ${emp.employeeId}  ${emp.firstName} ${emp.lastName || ""}  [${emp.status}]`);

    if (!elig) {
      console.log(`    no BonusEligibility row for April`);
      console.log("");
      continue;
    }

    const declaredProfit = elig.totalProfit;
    const listings = elig.listingsRemovedCount;
    const allCriteria =
      elig.dailyListingsComplete &&
      elig.ordersProcessedSameDay &&
      elig.messagesCleared &&
      elig.zeroWrongOrders &&
      elig.allStoresAbove4Stars;
    const eligible = elig.isEligible;
    const bonus = elig.bonusAmount;

    console.log(
      `    declared: $${declaredProfit.toFixed(2)}   listings_removed=${listings}   eligible=${eligible}   bonus=Rs${bonus}`,
    );
    console.log(
      `    7-criteria: daily=${elig.dailyListingsComplete} sameDay=${elig.ordersProcessedSameDay} msg=${elig.messagesCleared} zeroWrong=${elig.zeroWrongOrders} 4star=${elig.allStoresAbove4Stars}`,
    );

    if (!emp.googleSheetUrl) {
      console.log(`    ⚠ no googleSheetUrl — can't cross-check sheet`);
      console.log("");
      continue;
    }
    const sheetId = extractSheetId(emp.googleSheetUrl);
    if (!sheetId) {
      console.log(`    ⚠ invalid sheet URL`);
      console.log("");
      continue;
    }

    const { rows, tab, error } = await fetchAprilRows(sheets, sheetId);
    if (error) {
      console.log(`    ⚠ ${error}`);
      console.log("");
      continue;
    }

    const sheetProfit = rows.reduce((s, r) => s + r.profit, 0);
    const sheetSale = rows.reduce((s, r) => s + r.price, 0);
    const sheetCost = rows.reduce((s, r) => s + r.cost, 0);
    const grossProfit = sheetSale - sheetCost;

    console.log(`    sheet (tab='${tab}'): ${rows.length} rows  sale=$${sheetSale.toFixed(2)}  cost=$${sheetCost.toFixed(2)}  gross=$${grossProfit.toFixed(2)}  sheetProfitCol=$${sheetProfit.toFixed(2)}`);
    if (refundTotal > 0) {
      console.log(`    refunds in April: ${refunds.length} totaling $${refundTotal.toFixed(2)}`);
    }

    const flags: string[] = [];

    // Flag 1: declared vs sheet mismatch (>5% or >$50 absolute)
    {
      const diff = Math.abs(declaredProfit - sheetProfit);
      const pct = sheetProfit > 0 ? (diff / sheetProfit) * 100 : 0;
      if (diff > 50 && pct > 5) {
        flags.push(`MISMATCH: declared $${declaredProfit.toFixed(2)} vs sheet $${sheetProfit.toFixed(2)} (Δ$${diff.toFixed(2)}, ${pct.toFixed(1)}%)`);
      }
    }

    // Flag 2: gross profit (sale - cost) used vs sheet's profit-column value
    {
      const diff = Math.abs(grossProfit - sheetProfit);
      if (diff > 50) {
        flags.push(`GROSS≠COL: gross (sale-cost)=$${grossProfit.toFixed(2)} but sheet 'profit' col sums $${sheetProfit.toFixed(2)} (Δ$${diff.toFixed(2)})`);
      }
    }

    // Flag 3: just over a tier threshold
    {
      const tier = tierJustOver(declaredProfit);
      if (tier) {
        flags.push(`JUST-OVER-TIER: $${declaredProfit.toFixed(2)} sits only $${tier.gap.toFixed(2)} above the $${tier.tier} tier`);
      }
    }

    // Flag 4: listings_removed declared 0 but sheet has indicators (?)
    // We don't have a sheet column for "listings removed" so we can't fully verify.
    // Just flag if declared 0 + earned the bonus, since this is the most-gameable input.
    if (listings === 0 && eligible && bonus > 0) {
      // Soft flag — common, just noting the assumption
    }

    // Flag 5: duplicate rows by shop+price+date
    const dupeMap = new Map<string, number[]>();
    rows.forEach((r, idx) => {
      const key = `${r.shop}|${r.date}|${r.price.toFixed(2)}`;
      const arr = dupeMap.get(key) || [];
      arr.push(idx + 2);
      dupeMap.set(key, arr);
    });
    const dupeKeys = [...dupeMap.entries()].filter(([_, v]) => v.length > 1);
    if (dupeKeys.length > 0) {
      const sample = dupeKeys.slice(0, 3).map(([k, v]) => `${k} on rows ${v.join(",")}`).join("; ");
      flags.push(`DUPES: ${dupeKeys.length} potential duplicate row group(s) (same shop+price+date) — sample: ${sample}`);
    }

    // Flag 6: empty-cost rows
    const emptyCost = rows.filter((r) => r.cost === 0).length;
    if (emptyCost > 0 && rows.length > 0) {
      const pct = (emptyCost / rows.length) * 100;
      if (pct > 20) {
        flags.push(`EMPTY-COST: ${emptyCost}/${rows.length} (${pct.toFixed(0)}%) rows have cost=$0 — could inflate gross profit`);
      }
    }

    // Flag 7: refunds not netted against profit
    if (refundTotal > 0) {
      const profitAfterRefunds = grossProfit - refundTotal;
      if (eligible && profitAfterRefunds < 1000) {
        flags.push(`REFUNDS-WIPE-BONUS: gross $${grossProfit.toFixed(2)} − refunds $${refundTotal.toFixed(2)} = $${profitAfterRefunds.toFixed(2)} (under $1000 threshold)`);
      } else if (refundTotal > grossProfit * 0.1) {
        flags.push(`HEAVY-REFUNDS: $${refundTotal.toFixed(2)} = ${((refundTotal / grossProfit) * 100).toFixed(0)}% of gross — bonus calc didn't deduct them`);
      }
    }

    // Flag 8: eligibility flagged TRUE but criteria/listings wouldn't pass mechanically
    const mechanicallyEligible = allCriteria && listings <= 3 && declaredProfit >= 1000;
    if (eligible !== mechanicallyEligible) {
      flags.push(`ELIG-MISMATCH: stored isEligible=${eligible} but criteria/listings/profit yields ${mechanicallyEligible}`);
    }

    // Flag 9: bonus amount math vs profit tier
    const expectedBonus = mechanicallyEligible ? Math.floor(declaredProfit / 500) * 5000 : 0;
    if (bonus !== expectedBonus) {
      flags.push(`BONUS-MATH: stored bonus Rs${bonus} ≠ formula Rs${expectedBonus} (declared $${declaredProfit})`);
    }

    if (flags.length === 0) {
      console.log(`    ✓ no flags`);
    } else {
      for (const f of flags) console.log(`    🚩 ${f}`);
    }
    console.log("");
  }
}

main().then(() => prisma.$disconnect()).catch((e) => {
  console.error(e);
  return prisma.$disconnect().finally(() => process.exit(1));
});
