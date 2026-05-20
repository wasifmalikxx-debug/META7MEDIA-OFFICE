/**
 * Scan every Etsy seller's sheet and dump:
 *   - Column H "AFTER TAX" row sum                   ← what code uses now
 *   - Σ PROFIT column from rows                       ← AfterTax − Cost per row
 *   - Summary cell Y10/Z10 (sheet's "AFTER TAX" cell) ← what CEO likely means
 *
 * Use this to confirm the sheet's column "AFTER TAX" and summary
 * "AFTER TAX" cell give different numbers fleet-wide, and that the
 * CEO's intent is probably the summary cell.
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

  const employees = await prisma.user.findMany({
    where: {
      department: { name: { startsWith: "Etsy" } },
      status: "HIRED",
      googleSheetUrl: { not: null },
      employeeId: { notIn: ["EM-4L"] },
    },
    select: { employeeId: true, firstName: true, lastName: true, googleSheetUrl: true },
    orderBy: { employeeId: "asc" },
  });

  console.log(`SHEET LABEL AUDIT — ${month}/${year} (PKT)`);
  console.log("═".repeat(130));
  console.log(
    "Emp".padEnd(7) +
      " | " +
      "Name".padEnd(20) +
      " | " +
      "Σ COL G(Sale)".padStart(13) +
      " | " +
      "Σ COL H(AfterTax)".padStart(17) +
      " | " +
      "Σ COL J(PROFIT)".padStart(15) +
      " | " +
      "Z4 (T.SALE)".padStart(12) +
      " | " +
      "Z10 (AT)".padStart(12),
  );
  console.log("─".repeat(130));

  const parseMoney = (v: any): number => {
    if (v === null || v === undefined) return 0;
    const cleaned = String(v).replace(/[$,\s]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  };

  for (const emp of employees) {
    if (!emp.googleSheetUrl) continue;
    const sheetId = extractSheetId(emp.googleSheetUrl);
    if (!sheetId) continue;

    let actualTab: string | null = null;
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
      const candidateSet = new Set(getAlternativeTabNames(month, year).map(normalizeTabName));
      actualTab = tabs.find((t) => candidateSet.has(normalizeTabName(t))) || null;
    } catch (e) {
      console.log(`${emp.employeeId?.padEnd(7)} ${(emp.firstName + " " + (emp.lastName || "")).padEnd(20)} ERR: meta fetch`);
      continue;
    }
    if (!actualTab) {
      console.log(`${emp.employeeId?.padEnd(7)} ${(emp.firstName + " " + (emp.lastName || "")).padEnd(20)} ERR: tab not found`);
      continue;
    }

    let sumG = 0, sumH = 0, sumJ = 0;
    let summarySale = 0, summaryAT = 0;
    try {
      // Pull rows + summary in one batchGet
      const batch = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: sheetId,
        ranges: [`'${actualTab}'!A1:N1000`, `'${actualTab}'!Y1:Z15`],
      });
      const rows = (batch.data.valueRanges?.[0]?.values || []) as any[][];
      const summary = (batch.data.valueRanges?.[1]?.values || []) as any[][];

      // Find header row
      let headerIdx = -1;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const r = (rows[i] || []).map((c: any) => (c || "").toString().toLowerCase());
        if (r.some((c: string) => c.includes("order date") || c === "date")) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx < 0) continue;

      const headers = (rows[headerIdx] || []).map((h: any) => (h || "").toString().toLowerCase().trim());
      const iG = headers.findIndex((h) => h.includes("price") || h.includes("sale"));
      const iH = headers.findIndex((h) => h.includes("after tax"));
      const iJ = headers.findIndex((h) => h === "profit" || (h.includes("profit") && !h.includes("after")));

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const sale = parseMoney(row[iG]);
        if (sale <= 0) continue;
        sumG += sale;
        sumH += parseMoney(row[iH]);
        sumJ += parseMoney(row[iJ]);
      }

      // Summary cells — Y4 = "TOTAL SALE" label, Z4 = value; Y10 = "AFTER TAX", Z10 = value
      // Y starts at col index 0 in the Y1:Z15 range, Z at index 1
      const findRowByLabel = (label: string) => summary.findIndex((r: any[]) => (r?.[0] || "").toString().toLowerCase().includes(label));
      const saleRowIdx = findRowByLabel("total sale");
      const atRowIdx = findRowByLabel("after tax");
      if (saleRowIdx >= 0) summarySale = parseMoney(summary[saleRowIdx]?.[1]);
      if (atRowIdx >= 0) summaryAT = parseMoney(summary[atRowIdx]?.[1]);
    } catch (e: any) {
      console.log(`${emp.employeeId?.padEnd(7)} ${(emp.firstName + " " + (emp.lastName || "")).padEnd(20)} ERR: ${e.message?.slice(0, 40)}`);
      continue;
    }

    const fmt = (n: number) => (n > 0 ? `$${n.toFixed(0)}` : "—");
    console.log(
      `${(emp.employeeId || "?").padEnd(7)} | ${(emp.firstName + " " + (emp.lastName || "")).padEnd(20).slice(0, 20)} | ${fmt(sumG).padStart(13)} | ${fmt(sumH).padStart(17)} | ${fmt(sumJ).padStart(15)} | ${fmt(summarySale).padStart(12)} | ${fmt(summaryAT).padStart(12)}`,
    );
  }

  console.log("");
  console.log("═".repeat(130));
  console.log("Legend:");
  console.log("  COL G (Sale)     — real Etsy price column                                (= the actual sale)");
  console.log("  COL H (AfterTax) — sheet column labeled 'AFTER TAX' (sale − Etsy fees)   (= what code reads NOW)");
  console.log("  COL J (PROFIT)   — sheet column labeled 'PROFIT' (afterTax − cost)       (= per-row Net)");
  console.log("  Z4 'TOTAL SALE'  — summary cell labeled TOTAL SALE                       (often matches COL H sum!)");
  console.log("  Z10 'AFTER TAX'  — summary cell labeled AFTER TAX                        (= Net after Etsy fees + cost + 2% tax)");
}

main().catch(console.error).finally(() => prisma.$disconnect());
