/**
 * Quick header dump for AE-5's sheet so we can see what columns the cron
 * is matching against.
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
  const todayPkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = todayPkt.getUTCMonth() + 1;
  const year = todayPkt.getUTCFullYear();

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), "google-credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client as any });

  const probe = ["ME-3"];
  for (const empId of probe) {
    const u = await prisma.user.findFirst({
      where: { employeeId: empId },
      select: { googleSheetUrl: true },
    });
    if (!u?.googleSheetUrl) {
      console.log(`${empId}: no sheet URL in DB`);
      continue;
    }
    const sheetId = extractSheetId(u.googleSheetUrl);
    if (!sheetId) {
      console.log(`${empId}: invalid URL`);
      continue;
    }

    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
    const candidateSet = new Set(getAlternativeTabNames(month, year).map(normalizeTabName));
    const actualTab = tabs.find((t) => candidateSet.has(normalizeTabName(t)));
    if (!actualTab) {
      console.log(`${empId}: no matching tab — available: [${tabs.join(", ")}]`);
      continue;
    }

    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A1:N1`,
    });
    const headers = headerRes.data.values?.[0] || [];
    console.log(`\n━━ ${empId} (tab='${actualTab}') ━━`);
    headers.forEach((h: string, i: number) => {
      console.log(`  [${i}] '${h}'`);
    });

    // Pull first 2 data rows to see actual values
    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A2:N4`,
    });
    const rows = dataRes.data.values || [];
    rows.forEach((row: any[], idx: number) => {
      console.log(`  Row ${idx + 2}: ${row.map((c) => `"${c}"`).join(" | ")}`);
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().finally(() => process.exit(1)); });
