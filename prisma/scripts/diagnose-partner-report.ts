/**
 * Diagnostic: pull AE + ME team members from prod and read their Google
 * Sheets the exact same way /api/cron/daily-report does, so we can see
 * each employee's today + month numbers and spot any mismatch with what
 * Awais / Mubeen received on WhatsApp.
 *
 * Read-only — does NOT touch the DB or call WhatsApp.
 *
 * Usage:
 *   npx tsx prisma/scripts/diagnose-partner-report.ts
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

function isTodayCell(dateVal: string, todayPkt: Date): boolean {
  if (!dateVal) return false;
  const cleaned = dateVal.trim();
  const today = todayPkt.getUTCDate();
  const todayMonth = todayPkt.getUTCMonth();
  const todayYear = todayPkt.getUTCFullYear();
  const months: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };

  const dmy = cleaned.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)(?:[\s\-]+(\d{2,4}))?$/);
  if (dmy) {
    const day = parseInt(dmy[1]);
    const monthIdx = months[dmy[2].toLowerCase()];
    const year = dmy[3] ? (parseInt(dmy[3]) < 100 ? 2000 + parseInt(dmy[3]) : parseInt(dmy[3])) : todayYear;
    if (day === today && monthIdx === todayMonth && year === todayYear) return true;
  }

  const mdy = cleaned.match(/^([A-Za-z]+)[\s\-]+(\d{1,2})(?:[\s\-]+(\d{2,4}))?$/);
  if (mdy) {
    const monthIdx = months[mdy[1].toLowerCase()];
    const day = parseInt(mdy[2]);
    const year = mdy[3] ? (parseInt(mdy[3]) < 100 ? 2000 + parseInt(mdy[3]) : parseInt(mdy[3])) : todayYear;
    if (day === today && monthIdx === todayMonth && year === todayYear) return true;
  }

  const slash = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const a = parseInt(slash[1]);
    const b = parseInt(slash[2]);
    const yr = parseInt(slash[3]) < 100 ? 2000 + parseInt(slash[3]) : parseInt(slash[3]);
    if (yr === todayYear) {
      if (a === todayMonth + 1 && b === today) return true;
      if (b === todayMonth + 1 && a === today) return true;
    }
  }

  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    if (
      parsed.getUTCDate() === today &&
      parsed.getUTCMonth() === todayMonth &&
      parsed.getUTCFullYear() === todayYear
    ) return true;
  }
  return false;
}

async function main() {
  const todayPkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = todayPkt.getUTCMonth() + 1;
  const year = todayPkt.getUTCFullYear();
  console.log(`Month: ${month}/${year}   Today (PKT): ${todayPkt.toISOString().slice(0, 10)}\n`);

  const auth = process.env.GOOGLE_CREDENTIALS
    ? new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      })
    : new google.auth.GoogleAuth({
        keyFile: path.join(process.cwd(), "google-credentials.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client as any });

  // Also probe the EM team via SHEET_MAP equivalents (CEO loop).
  const SHEET_MAP: Record<string, string> = {
    "EM-1": "1JDOuuUMho1LnEDZFkk8x7K3cD0A0NFALGH3WuVqz-bo",
    "EM-2": "1kZCi5WbjjVqLwm_bijg-i74zIQxKmjCeRv3ORS-D0eU",
    "EM-3": "1MUpjkITaOp-yKM051v1lQqtFzLQVY0VZDAd9F6KBgZI",
    "EM-4B": "1SLlTv1b8wOPDkMBuNeFpgDZk3oi9OhQCB7enXzOJz6Y",
    "EM-5": "1iEebhf_OtMJJg8S0Oyuol9g_oOSuhUbEfTiwr8pLT5w",
    "EM-6": "1Nz1MeWZeeolbmks7GwT99TD7SFMXlmtHA_tXlqqyqpc",
    "EM-7": "1yKHQM8_FJofJcLr7VFAHbeWxKkwJhFKhiaEiwxAWw4Q",
    "EM-8": "1HC2ds9epnJp8zgq5FJkjLODF_1Bc4Xtnsp32jbbWSrg",
    "EM-9": "10pkeYRvmPFFDTFvTilANVeDw7-r0HvYy7m0Z2fkFdgM",
    "EM-10": "1X3s8bZ8z28p-Qu70-yoa4tGmdkLZWzFOB9vpDNdhXHc",
  };
  console.log(`━━━ Wasif (CEO) → EM team via SHEET_MAP (${Object.keys(SHEET_MAP).length} sheets) ━━━`);
  let emTodayOrders = 0, emTodaySale = 0, emMonthOrders = 0, emMonthSale = 0;
  for (const empId of Object.keys(SHEET_MAP).sort()) {
    const sheetId = SHEET_MAP[empId];
    try {
      let actualTab: string | null = null;
      let availableTabs: string[] = [];
      try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
        availableTabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
        const candidateSet = new Set(getAlternativeTabNames(month, year).map(normalizeTabName));
        const found = availableTabs.find((t) => candidateSet.has(normalizeTabName(t)));
        if (found) actualTab = found;
      } catch {}
      if (!actualTab) {
        console.log(`  ${empId}  no tab match — available: [${availableTabs.join(", ")}]`);
        continue;
      }
      const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${actualTab}'!A1:J1` });
      const headers = (headerRes.data.values?.[0] || []).map((h: string) => h.toLowerCase().trim());
      const dateCol = headers.findIndex((h: string) => h.includes("order date") || h.includes("date"));
      const priceCol = headers.findIndex((h: string) => h.includes("price"));
      if (dateCol === -1) {
        console.log(`  ${empId}  tab '${actualTab}' has no date col`);
        continue;
      }
      const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${actualTab}'!A2:J1000` });
      const rows = dataRes.data.values || [];
      let today = 0, todayS = 0, mo = 0, moS = 0;
      const samples: string[] = [];
      for (const row of rows) {
        const dateVal = (row[dateCol] || "").toString().trim();
        if (!dateVal) continue;
        const sale = priceCol >= 0 ? parseDollar(row[priceCol]) : 0;
        mo++; moS += sale;
        if (samples.length < 2) samples.push(dateVal);
        if (isTodayCell(dateVal, todayPkt)) { today++; todayS += sale; }
      }
      emTodayOrders += today; emTodaySale += todayS;
      emMonthOrders += mo; emMonthSale += moS;
      console.log(`  ${empId}  tab='${actualTab}'  today=${today} ($${todayS.toFixed(2)})   month=${mo} ($${moS.toFixed(2)})   sample=[${samples.join(", ")}]`);
    } catch (e: any) {
      console.log(`  ${empId}  error: ${e.message?.slice(0, 80)}`);
    }
  }
  console.log(`  TEAM TOTAL: today=${emTodayOrders} ($${emTodaySale.toFixed(2)})   month=${emMonthOrders} ($${emMonthSale.toFixed(2)})\n`);

  const partners = await prisma.user.findMany({
    where: {
      role: "PARTNER",
      partnerTeams: {
        some: { department: { name: { startsWith: "Etsy - " } } },
      },
    },
    select: {
      firstName: true,
      partnerTeams: {
        where: { department: { name: { startsWith: "Etsy - " } } },
        select: {
          department: { select: { name: true } },
          members: {
            where: { status: { in: ["HIRED", "PROBATION"] } },
            select: { employeeId: true, firstName: true, status: true, googleSheetUrl: true },
            orderBy: { employeeId: "asc" },
          },
        },
      },
    },
  });

  for (const partner of partners) {
    for (const team of partner.partnerTeams) {
      console.log(`━━━ ${partner.firstName} → ${team.department?.name} (${team.members.length} member(s)) ━━━`);
      let teamTodayOrders = 0, teamTodaySale = 0;
      let teamMonthOrders = 0, teamMonthSale = 0;

      for (const m of team.members) {
        const status = m.status;
        if (!m.googleSheetUrl) {
          console.log(`  ${m.employeeId}  [${status}]  no sheet URL`);
          continue;
        }
        const sheetId = extractSheetId(m.googleSheetUrl);
        if (!sheetId) {
          console.log(`  ${m.employeeId}  [${status}]  invalid URL`);
          continue;
        }
        try {
          // Fuzzy tab match using all candidate names
          let actualTab: string | null = null;
          let availableTabs: string[] = [];
          try {
            const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
            availableTabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
            const candidateSet = new Set(getAlternativeTabNames(month, year).map(normalizeTabName));
            const found = availableTabs.find((t) => candidateSet.has(normalizeTabName(t)));
            if (found) actualTab = found;
          } catch {}

          if (!actualTab) {
            console.log(`  ${m.employeeId}  [${status}]  no tab match — available: [${availableTabs.join(", ")}]`);
            continue;
          }

          const headerRes = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `'${actualTab}'!A1:N1`,
          });
          const headersRaw = (headerRes.data.values?.[0] || []) as string[];
          const headers = headersRaw.map((h: string) => h.toLowerCase().trim());
          const dateCol = headers.findIndex((h: string) => h.includes("order date") || h.includes("date"));
          const priceCol = headers.findIndex((h: string) => h.includes("price"));
          const costCol = headers.findIndex((h: string) => h.includes("cost"));
          if (dateCol === -1) {
            console.log(`  ${m.employeeId}  [${status}]  tab '${actualTab}' has no date col`);
            continue;
          }

          const dataRes = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `'${actualTab}'!A2:N1000`,
          });
          const rows = dataRes.data.values || [];
          let todayOrders = 0, todaySale = 0, todayCost = 0;
          let monthOrders = 0, monthSale = 0, monthCost = 0;
          const dateSamples: string[] = [];

          for (const row of rows) {
            const dateVal = (row[dateCol] || "").toString().trim();
            if (!dateVal) continue;
            const rowSale = priceCol >= 0 ? parseDollar(row[priceCol]) : 0;
            const rowCost = costCol >= 0 ? parseDollar(row[costCol]) : 0;
            monthOrders++;
            monthSale += rowSale;
            monthCost += rowCost;
            if (dateSamples.length < 3) dateSamples.push(dateVal);
            if (isTodayCell(dateVal, todayPkt)) {
              todayOrders++;
              todaySale += rowSale;
              todayCost += rowCost;
            }
          }

          // Gross profit = sale - cost (matches the cron's calculation).
          const todayGross = todaySale - todayCost;
          const monthGross = monthSale - monthCost;
          teamTodayOrders += todayOrders;
          teamTodaySale += todaySale;
          teamMonthOrders += monthOrders;
          teamMonthSale += monthSale;

          console.log(
            `  ${m.employeeId}  [${status}]  today=${todayOrders}  sale=$${todaySale.toFixed(2)}  cost=$${todayCost.toFixed(2)}  gross=$${todayGross.toFixed(2)}   month=${monthOrders} ($${monthSale.toFixed(2)} sale, $${monthGross.toFixed(2)} gross)`
          );
        } catch (e: any) {
          console.log(`  ${m.employeeId}  [${status}]  error: ${e.message?.slice(0, 80)}`);
        }
      }

      console.log(`  TEAM TOTAL: today=${teamTodayOrders} ($${teamTodaySale.toFixed(2)})   month=${teamMonthOrders} ($${teamMonthSale.toFixed(2)})\n`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
