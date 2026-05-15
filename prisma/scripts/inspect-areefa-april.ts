/**
 * Dump Areefa's April analytics area to see exactly what cell is labeled
 * "AFTER TAX" and what value is in it. The bonus program's declared value
 * comes from fetchProfitFromSheet which reads this label.
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

async function main() {
  const employeeId = process.env.EMP_ID || "EM-9";
  const month = parseInt(process.env.MONTH || "4");
  const year = parseInt(process.env.YEAR || "2026");

  const u = await prisma.user.findFirst({
    where: { employeeId },
    select: { firstName: true, lastName: true, googleSheetUrl: true },
  });
  if (!u?.googleSheetUrl) {
    console.log(`${employeeId}: no sheet URL`);
    return;
  }
  const sheetId = extractSheetId(u.googleSheetUrl);
  if (!sheetId) return;

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), "google-credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client as any });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
  const candidateSet = new Set(getAlternativeTabNames(month, year).map(normalizeTabName));
  const actualTab = tabs.find((t) => candidateSet.has(normalizeTabName(t)));
  if (!actualTab) {
    console.log(`No matching tab. Available: ${tabs.join(", ")}`);
    return;
  }

  console.log(`${employeeId} (${u.firstName} ${u.lastName || ""})  tab='${actualTab}'\n`);

  // Dump the entire V1:AD15 analytics area
  const v = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${actualTab}'!V1:AD15`,
  });
  const rows = v.data.values || [];

  console.log(`Analytics block (V1:AD15) — every non-empty cell:`);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      const cell = String(rows[r][c] || "").trim();
      if (cell.length === 0) continue;
      // V is col 22 (index 21), so absolute column = V + c = 22 + c (1-indexed)
      const absoluteCol = String.fromCharCode(86 + c); // V=86 in ASCII... wait V is char 86
      console.log(`  ${absoluteCol}${r + 1}: '${cell}'`);
    }
  }

  // Also dump some context around the "AFTER TAX" and "GROSS PROFIT" labels
  console.log(`\nLooking for label cells:`);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      const cell = String(rows[r][c] || "").trim().toUpperCase();
      if (cell === "AFTER TAX" || cell === "GROSS PROFIT" || cell === "TOTAL SALE" || cell === "TOTAL COST") {
        // Print neighbors
        const right = rows[r][c + 1] || "";
        const below = rows[r + 1]?.[c] || "";
        const rightBelow = rows[r + 1]?.[c + 1] || "";
        console.log(`  '${cell}' at row ${r + 1}, col offset ${c}:  right='${right}'  below='${below}'  diag='${rightBelow}'`);
      }
    }
  }

  // What does the actual fetchProfitFromSheet helper return?
  const { fetchProfitFromSheet } = await import("../../src/lib/services/google-sheets.service");
  const result = await fetchProfitFromSheet(u.googleSheetUrl, month, year);
  console.log(`\nfetchProfitFromSheet result:`, result);
}

main().then(() => prisma.$disconnect()).catch((e) => {
  console.error(e);
  return prisma.$disconnect().finally(() => process.exit(1));
});
