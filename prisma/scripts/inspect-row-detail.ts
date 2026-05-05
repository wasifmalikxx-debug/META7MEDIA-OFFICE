/**
 * Walks an employee's monthly tab and reports:
 *   - rows the cron currently counts (date present)
 *   - rows the analytics-style filter would skip (no shop, or no price)
 *   - duplicate order numbers (one Etsy order with multiple SKU rows)
 *
 *   EMP_ID=AE-1 npx tsx prisma/scripts/inspect-row-detail.ts
 */
import { google } from "googleapis";
import path from "path";
import { PrismaClient } from "@prisma/client";
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

async function main() {
  const empId = process.env.EMP_ID || "ME-1";
  const todayPkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = todayPkt.getUTCMonth() + 1;
  const year = todayPkt.getUTCFullYear();

  const u = await prisma.user.findFirst({
    where: { employeeId: empId },
    select: { firstName: true, googleSheetUrl: true },
  });
  if (!u?.googleSheetUrl) return;
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
    console.log(`No matching tab for ${empId}`);
    return;
  }

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${actualTab}'!A1:N1`,
  });
  const headers = (headerRes.data.values?.[0] || []).map((h: string) => h.toLowerCase().trim());
  const dateCol = headers.findIndex((h: string) => h.includes("order date") || h.includes("date"));
  const priceCol = headers.findIndex((h: string) => h.includes("price"));
  const costCol = headers.findIndex((h: string) => h.includes("cost"));
  const shopCol = headers.findIndex((h: string) => h.includes("store") || h.includes("shop"));
  const orderIdCol = headers.findIndex(
    (h: string) => h.includes("order number") || h.includes("order #") || h.includes("ordder #") || h.includes("order id"),
  );
  console.log(
    `${empId} (${u.firstName})  tab='${actualTab}'  cols: date=${dateCol} shop=${shopCol} price=${priceCol} cost=${costCol} orderId=${orderIdCol}\n`,
  );

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${actualTab}'!A2:N1000`,
  });
  const rows = dataRes.data.values || [];

  let cronCounted = 0;
  let analyticsCounted = 0; // requires shop AND date AND price
  const orderIdsSeen = new Map<string, number[]>(); // id → [row numbers]
  const flagged: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const dateVal = (row[dateCol] || "").toString().trim();
    const shopVal = shopCol >= 0 ? (row[shopCol] || "").toString().trim() : "";
    const priceVal = priceCol >= 0 ? (row[priceCol] || "").toString().trim() : "";
    const costVal = costCol >= 0 ? (row[costCol] || "").toString().trim() : "";
    const orderId = orderIdCol >= 0 ? (row[orderIdCol] || "").toString().trim() : "";

    if (!dateVal) continue;
    const lineNo = i + 2;

    cronCounted++;
    const passesAnalyticsFilter =
      !!shopVal &&
      !shopVal.toUpperCase().includes("STORE NAME") &&
      !shopVal.toUpperCase().startsWith("SHOP") &&
      parseDollar(priceVal) > 0;
    if (passesAnalyticsFilter) analyticsCounted++;

    // Duplicate order ID detection
    if (orderId) {
      const seen = orderIdsSeen.get(orderId) || [];
      seen.push(lineNo);
      orderIdsSeen.set(orderId, seen);
    }

    // Flag suspicious rows
    if (!shopVal) flagged.push(`row ${lineNo}: NO SHOP — date='${dateVal}' price='${priceVal}'`);
    else if (parseDollar(priceVal) <= 0) flagged.push(`row ${lineNo}: NO PRICE — date='${dateVal}' shop='${shopVal}' price='${priceVal}'`);
  }

  // Find duplicates
  const duplicates: string[] = [];
  for (const [id, lines] of orderIdsSeen) {
    if (lines.length > 1) {
      duplicates.push(`order ${id} appears on rows ${lines.join(", ")}`);
    }
  }

  console.log(`Cron counts (date present):       ${cronCounted}`);
  console.log(`Analytics-filtered (shop+price>0): ${analyticsCounted}`);
  console.log(`Difference: ${cronCounted - analyticsCounted}`);
  console.log(`\nDuplicate order IDs (would imply same order counted twice): ${duplicates.length}`);
  duplicates.slice(0, 10).forEach((d) => console.log(`  ${d}`));

  console.log(`\nSuspicious rows that cron counts but analytics would skip: ${flagged.length}`);
  flagged.slice(0, 30).forEach((f) => console.log(`  ${f}`));
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().finally(() => process.exit(1)); });
