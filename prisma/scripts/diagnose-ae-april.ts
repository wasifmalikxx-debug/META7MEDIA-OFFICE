/**
 * Diagnostic: why does Awais's April 2026 Bonus Program show "4 sheets had
 * errors"? AE team was provisioned May 4, so April data may not exist on
 * any of their sheets — but the page surfaces a generic error. This walks
 * each AE member's sheet, attempts to find the April tab, and reports
 * exactly what the partner-side fetch is seeing.
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
  const month = 4;
  const year = 2026;

  const dept = await prisma.department.findFirst({ where: { name: "Etsy - AE" } });
  if (!dept) {
    console.log("Etsy - AE department not found");
    return;
  }
  const employees = await prisma.user.findMany({
    where: { departmentId: dept.id, status: { in: ["HIRED", "PROBATION"] } },
    select: {
      employeeId: true,
      firstName: true,
      lastName: true,
      status: true,
      googleSheetUrl: true,
      joiningDate: true,
    },
    orderBy: { employeeId: "asc" },
  });

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), "google-credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client as any });

  const candidateNames = getAlternativeTabNames(month, year);
  const candidateSet = new Set(candidateNames.map(normalizeTabName));
  console.log(`Looking for April 2026 tab. Candidates: [${candidateNames.join(", ")}]\n`);

  for (const emp of employees) {
    const join = emp.joiningDate?.toISOString().slice(0, 10) || "—";
    console.log(`▸ ${emp.employeeId}  ${emp.firstName} ${emp.lastName || ""}  [${emp.status}]  joined ${join}`);

    if (!emp.googleSheetUrl) {
      console.log(`    ✗ no sheet URL`);
      console.log("");
      continue;
    }
    const sheetId = extractSheetId(emp.googleSheetUrl);
    if (!sheetId) {
      console.log(`    ✗ invalid sheet URL: ${emp.googleSheetUrl}`);
      console.log("");
      continue;
    }

    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
      console.log(`    available tabs: [${tabs.join(", ")}]`);

      const found = tabs.find((t) => candidateSet.has(normalizeTabName(t)));
      if (!found) {
        console.log(`    ✗ no April tab matches`);
        console.log("");
        continue;
      }
      console.log(`    ✓ April tab: '${found}'`);

      // Mimic fetchProfitFromSheet — read Y10 area for "AFTER TAX" / GROSS PROFIT
      try {
        const v = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'${found}'!V1:AD15`,
        });
        const rows = v.data.values || [];
        let labelHits: string[] = [];
        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < (rows[r] || []).length; c++) {
            const cell = String(rows[r][c] || "").trim().toUpperCase();
            if (cell.includes("AFTER TAX") || cell.includes("GROSS PROFIT")) {
              const valueCell = rows[r][c + 1] || rows[r + 1]?.[c] || "";
              labelHits.push(`'${cell}' @ V1+(${r},${c}) → next='${valueCell}'`);
            }
          }
        }
        if (labelHits.length === 0) {
          console.log(`    ⚠ analytics block (V1:AD15) empty / no GROSS PROFIT or AFTER TAX label`);
        } else {
          for (const h of labelHits.slice(0, 3)) console.log(`    analytics: ${h}`);
        }

        // Also count how many actual data rows the April tab has
        const dataRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'${found}'!A2:N1000`,
        });
        const dataRows = (dataRes.data.values || []).filter((row: any[]) => (row[0] || row[1] || row[2] || row[3] || row[4] || "").toString().trim().length > 0);
        console.log(`    data rows in April tab: ${dataRows.length}`);
      } catch (innerErr: any) {
        console.log(`    ⚠ error reading tab data: ${innerErr.message?.slice(0, 100)}`);
      }
    } catch (e: any) {
      console.log(`    ✗ failed to open sheet: ${e.message?.slice(0, 100)}`);
    }
    console.log("");
  }
}

main().then(() => prisma.$disconnect()).catch((e) => {
  console.error(e);
  return prisma.$disconnect().finally(() => process.exit(1));
});
