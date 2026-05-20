/**
 * Pull Sufyan's raw sheet for May 2026 and print:
 *   - every column header the system sees
 *   - which header maps to which canonical field (sale / cost / afterTax / profit)
 *   - sum of every numeric column directly from the cells
 *   - first 3 data rows raw
 *
 * Goal: prove (or disprove) that the system is reading the right column
 * for AFTER TAX. The CEO believes the bonus is using TOTAL SALES instead.
 */

import { google } from "googleapis";
import path from "path";
import {
  extractSheetId,
  normalizeTabName,
  getAlternativeTabNames,
} from "../../src/lib/services/google-sheets.service";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const today = new Date(Date.now() + 5 * 60 * 60_000);
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), "google-credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client as any });

  const sufyan = await prisma.user.findFirst({
    where: { employeeId: "EM-3" },
    select: { firstName: true, lastName: true, googleSheetUrl: true },
  });
  if (!sufyan?.googleSheetUrl) {
    console.log("No sheet URL");
    return;
  }
  const sheetId = extractSheetId(sufyan.googleSheetUrl);
  if (!sheetId) return;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
  const candidateSet = new Set(getAlternativeTabNames(month, year).map(normalizeTabName));
  const actualTab = tabs.find((t) => candidateSet.has(normalizeTabName(t)));
  if (!actualTab) {
    console.log(`No matching tab. Available: ${tabs.join(", ")}`);
    return;
  }

  console.log(`SHEET: ${sufyan.firstName} ${sufyan.lastName} (EM-3)`);
  console.log(`Tab matched: '${actualTab}' for ${month}/${year}`);
  console.log("═".repeat(110));

  // Pull preview to detect header row (same as the parser)
  const preview = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${actualTab}'!A1:N5`,
  });
  const rows = preview.data.values || [];

  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = (rows[i] || []).map((c: any) => (c || "").toString().toLowerCase().trim());
    if (r.some((c: string) => c.includes("order date") || c === "date")) {
      headerRowIdx = i;
      break;
    }
  }
  console.log(`\nHeader row detected at index: ${headerRowIdx} (sheet row ${headerRowIdx + 1})`);
  console.log("");

  const headers: string[] = (rows[headerRowIdx] || []).map((c: any) => (c || "").toString());

  console.log("ALL COLUMNS FOUND:");
  headers.forEach((h, i) => {
    const colLetter = String.fromCharCode(65 + i); // A, B, C, ...
    console.log(`  [${colLetter}] (idx ${i}) '${h}'`);
  });
  console.log("");

  // Show how the parser maps each header to a canonical field
  // Replicates the column-detect logic in fetchSheetAnalytics
  const norm = headers.map((h) => h.toLowerCase().trim());
  const idx = {
    date:     norm.findIndex((h) => h.includes("order date") || h === "date"),
    price:    norm.findIndex((h) => h.includes("sale") || h.includes("price")),
    afterTax: norm.findIndex((h) => h.includes("after tax")),
    cost:     norm.findIndex((h) => h.includes("cost") && !h.includes("after")),
    profit:   norm.findIndex((h) => h === "profit" || h.includes("profit") || h.includes("net")),
    orderId:  norm.findIndex((h) => h.includes("order id") || h.includes("order#") || h === "order"),
  };

  console.log("PARSER COLUMN MAPPING:");
  console.log(`  date      → col ${idx.date >= 0 ? String.fromCharCode(65 + idx.date) : "?"} '${headers[idx.date] || "—"}'`);
  console.log(`  sale      → col ${idx.price >= 0 ? String.fromCharCode(65 + idx.price) : "?"} '${headers[idx.price] || "—"}'`);
  console.log(`  AFTER TAX → col ${idx.afterTax >= 0 ? String.fromCharCode(65 + idx.afterTax) : "?"} '${headers[idx.afterTax] || "—"}'  ← bonus input`);
  console.log(`  cost      → col ${idx.cost >= 0 ? String.fromCharCode(65 + idx.cost) : "?"} '${headers[idx.cost] || "—"}'`);
  console.log(`  profit    → col ${idx.profit >= 0 ? String.fromCharCode(65 + idx.profit) : "?"} '${headers[idx.profit] || "—"}'`);
  console.log("");

  // Pull all data rows (A:N from row after header onwards)
  const startRow = headerRowIdx + 2; // 1-indexed for sheets
  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${actualTab}'!A${startRow}:N1000`,
  });
  const dataRows = dataRes.data.values || [];

  console.log(`First 3 data rows raw (row ${startRow}+):`);
  dataRows.slice(0, 3).forEach((row: any[], i: number) => {
    console.log(`  Row ${startRow + i}:`);
    headers.forEach((h, j) => {
      console.log(`    ${String.fromCharCode(65 + j).padEnd(2)} ${(h || "").padEnd(15)}: '${row[j] ?? ""}'`);
    });
  });
  console.log("");

  // Sum each numeric column directly
  const parseMoney = (v: any): number => {
    if (v === null || v === undefined) return 0;
    const cleaned = String(v).replace(/[$,\s]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  };

  let sumSale = 0,
    sumAfterTax = 0,
    sumCost = 0,
    sumProfit = 0,
    countRows = 0,
    countWithPrice = 0;
  for (const row of dataRows) {
    countRows++;
    const sale = parseMoney(row[idx.price]);
    const afterTax = parseMoney(row[idx.afterTax]);
    const cost = parseMoney(row[idx.cost]);
    const profit = parseMoney(row[idx.profit]);
    if (sale > 0) {
      countWithPrice++;
      sumSale += sale;
      sumAfterTax += afterTax;
      sumCost += cost;
      sumProfit += profit;
    }
  }

  console.log("DIRECT COLUMN SUMS:");
  console.log(`  Rows scanned:     ${countRows}`);
  console.log(`  Rows with price:  ${countWithPrice}`);
  console.log(`  Σ SALE column:    $${sumSale.toFixed(2)}    ← if bonus = sales, this would feed bonus`);
  console.log(`  Σ AFTER TAX col:  $${sumAfterTax.toFixed(2)}    ← actually feeds bonus (per code)`);
  console.log(`  Σ COST column:    $${sumCost.toFixed(2)}`);
  console.log(`  Σ PROFIT column:  $${sumProfit.toFixed(2)}    (sheet column ≈ afterTax − cost = NET)`);
  console.log("");

  // Cross-reference what the system stored
  const elig = await prisma.bonusEligibility.findFirst({
    where: { user: { employeeId: "EM-3" }, month, year },
  });
  console.log("WHAT THE SYSTEM STORED:");
  console.log(`  bonusEligibility.totalProfit = $${elig?.totalProfit?.toFixed(2) ?? "—"}`);
  console.log(`  bonusEligibility.bonusAmount = PKR ${elig?.bonusAmount?.toLocaleString() ?? "—"}`);
  console.log("");

  // Diagnose
  if (elig?.totalProfit) {
    const stored = elig.totalProfit;
    const matchSale = Math.abs(stored - sumSale) < 1;
    const matchAT = Math.abs(stored - sumAfterTax) < 1;
    const matchProfit = Math.abs(stored - sumProfit) < 1;
    console.log("DIAGNOSIS:");
    if (matchSale) console.log("  ✗ Stored matches Σ SALE — bonus is using SALES, not AFTER TAX");
    else if (matchAT) console.log("  ✓ Stored matches Σ AFTER TAX — correct per rule");
    else if (matchProfit) console.log("  ⚠ Stored matches Σ PROFIT — bonus is using NET, not AFTER TAX");
    else console.log("  ? Stored doesn't match any column directly (could be stale)");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
