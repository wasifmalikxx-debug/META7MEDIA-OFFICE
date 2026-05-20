/**
 * Pull the SUMMARY AREA of Sufyan's sheet (cells V1:AD15) — this is
 * where the CEO + sellers see the headline totals. If the CEO is
 * looking at the summary and thinking "bonus should be after tax = X"
 * but the row sum gives Y, that's the disconnect.
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
    select: { googleSheetUrl: true },
  });
  if (!sufyan?.googleSheetUrl) return;
  const sheetId = extractSheetId(sufyan.googleSheetUrl);
  if (!sheetId) return;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
  const candidateSet = new Set(getAlternativeTabNames(month, year).map(normalizeTabName));
  const actualTab = tabs.find((t) => candidateSet.has(normalizeTabName(t)));
  if (!actualTab) return;

  // Pull a wider range V1:AD20 (summary cells live here)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${actualTab}'!V1:AE20`,
  });
  const rows = res.data.values || [];

  console.log(`SUFYAN's SHEET SUMMARY AREA — tab '${actualTab}'`);
  console.log("Range V1:AE20 — anything visible here is what the CEO sees as 'totals'");
  console.log("═".repeat(110));

  rows.forEach((row: any[], i: number) => {
    const nonEmpty = row.some((c) => c !== "" && c !== undefined && c !== null);
    if (!nonEmpty) return;
    console.log(`Row ${i + 1}:`);
    row.forEach((c: any, j: number) => {
      if (c === "" || c === undefined || c === null) return;
      const col = String.fromCharCode("V".charCodeAt(0) + j);
      console.log(`  ${col}${i + 1}: "${c}"`);
    });
    console.log("");
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
