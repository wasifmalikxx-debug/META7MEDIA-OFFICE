/**
 * Parallel verification: runs the daily-report cron's `readEmployeeSheetReport`
 * parsing AND the analytics service's `fetchSheetAnalytics` against the same
 * live sheets in one session, then diffs every employee.
 *
 * If both pipelines parse the same way, every employee should show
 * "✓ match" and the team totals at the bottom should be identical.
 *
 * Run:
 *   npx tsx prisma/scripts/verify-pipelines-match.ts
 *   MONTH=4 YEAR=2026 npx tsx prisma/scripts/verify-pipelines-match.ts
 */

import { prisma } from "../../src/lib/prisma";
import {
  fetchAllSheetAnalytics,
  extractSheetId,
  normalizeTabName,
  getAlternativeTabNames,
} from "../../src/lib/services/google-sheets.service";
import { google } from "googleapis";
import path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pktNow = new Date(Date.now() + 5 * 60 * 60_000);
const MONTH = parseInt(process.env.MONTH || String(pktNow.getUTCMonth() + 1));
const YEAR = parseInt(process.env.YEAR || String(pktNow.getUTCFullYear()));

// ─── parseDollar — identical to the cron's helper ───────────────────
function parseDollar(val: string | undefined): number {
  if (!val) return 0;
  return parseFloat(val.replace(/[$,\s]/g, "")) || 0;
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

/**
 * VERBATIM copy of the relevant portion of the daily-report cron's
 * readEmployeeSheetReport. This is the exact code that ships to prod.
 * Returns only month aggregates (today is irrelevant for this check).
 */
async function cronReadMonth(
  sheets: any,
  sheetUrl: string,
  month: number,
  year: number,
): Promise<{
  monthOrders: number;
  monthSale: number;
  monthCost: number;
  monthProfit: number;
  tab: string | null;
}> {
  const empty = {
    monthOrders: 0,
    monthSale: 0,
    monthCost: 0,
    monthProfit: 0,
    tab: null as string | null,
  };

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) return empty;

  try {
    let actualTab: string | null = null;
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const tabs = meta.data.sheets?.map((s: any) => s.properties?.title || "") || [];
      const candidates = getAlternativeTabNames(month, year).map(normalizeTabName);
      const candidateSet = new Set(candidates);
      const found = tabs.find((t: string) => candidateSet.has(normalizeTabName(t)));
      if (found) actualTab = found;
    } catch {
      // fall through to empty
    }
    if (!actualTab) return empty;

    const previewRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A1:N5`,
    });
    const previewRows = (previewRes.data.values || []) as string[][];

    let headerRowIdx = -1;
    for (let i = 0; i < previewRows.length; i++) {
      const row = (previewRows[i] || []).map((c: string) =>
        (c || "").toString().toLowerCase().trim(),
      );
      if (row.some((c: string) => c.includes("order date") || c === "date")) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) return empty;

    const headers = (previewRows[headerRowIdx] || []).map((h: string) =>
      (h || "").toString().toLowerCase().trim(),
    );
    const dateCol = headers.findIndex(
      (h: string) => h.includes("order date") || h.includes("date"),
    );
    const priceCol = headers.findIndex((h: string) => h.includes("price"));
    const costCol = headers.findIndex((h: string) => h.includes("cost"));
    const orderIdCol = headers.findIndex(
      (h: string) =>
        h.includes("order number") ||
        h.includes("order #") ||
        h.includes("ordder #") ||
        h.includes("order id") ||
        h === "ae order",
    );
    if (dateCol === -1) return { ...empty, tab: actualTab };

    const dataStartRow = headerRowIdx + 2;
    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A${dataStartRow}:N1000`,
    });
    const rows = (dataRes.data.values || []) as string[][];

    let monthOrders = 0;
    let monthSale = 0;
    let monthCost = 0;
    const monthOrderIds = new Set<string>();

    for (const row of rows) {
      const dateVal = (row[dateCol] || "").toString().trim();
      if (!dateVal) continue;
      const rowSale = priceCol >= 0 ? parseDollar(row[priceCol]) : 0;
      if (rowSale <= 0) continue;
      const rowCost = costCol >= 0 ? parseDollar(row[costCol]) : 0;
      const orderId =
        orderIdCol >= 0 ? (row[orderIdCol] || "").toString().trim() : "";

      monthSale += rowSale;
      monthCost += rowCost;
      if (!orderId || !monthOrderIds.has(orderId)) {
        monthOrders++;
        if (orderId) monthOrderIds.add(orderId);
      }
    }

    return {
      monthOrders,
      monthSale,
      monthCost,
      monthProfit: monthSale - monthCost,
      tab: actualTab,
    };
  } catch {
    return empty;
  }
}

async function main() {
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

  console.log(`\n╔══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║  PARALLEL VERIFICATION — Daily-Report cron  vs  Analytics service    ║`);
  console.log(`║  Month: ${MONTH}/${YEAR}  ·  Employees: ${employees.length}                                    ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════╝\n`);

  // Pipeline A — daily-report cron's parsing.
  console.log(`Running daily-report cron parsing on ${employees.length} sheets…`);
  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: "v4", auth: authClient as any });
  const cronResults: Record<string, Awaited<ReturnType<typeof cronReadMonth>>> = {};
  const BATCH = 3;
  for (let i = 0; i < employees.length; i += BATCH) {
    const batch = employees.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (emp) => {
        cronResults[emp.id] = await cronReadMonth(
          sheets,
          emp.googleSheetUrl!,
          MONTH,
          YEAR,
        );
      }),
    );
  }

  // Pipeline B — analytics service (post-fix).
  console.log(`Running analytics service on ${employees.length} sheets…\n`);
  const analyticsSheets = employees.map((e) => ({
    userId: e.id,
    sheetUrl: e.googleSheetUrl!,
  }));
  const analyticsData = await fetchAllSheetAnalytics(analyticsSheets, MONTH, YEAR);

  // ─── Diff per employee ─────────────────────────────────────────────
  type Row = {
    emp: string;
    team: string;
    cronOrders: number;
    cronSale: number;
    cronCost: number;
    cronProfit: number;
    cronTab: string | null;
    aOrders: number;
    aSale: number;
    aCost: number;
    aProfit: number;
    match: boolean;
  };
  const rows: Row[] = [];

  // Surface fetch errors per pipeline. Both code paths swallow quota /
  // network errors and return zero-rows; without this we can't tell a
  // quota miss from a legitimately-empty sheet.
  const cronErrors: { emp: string; reason: string }[] = [];
  const analyticsErrors: { emp: string; reason: string }[] = [];

  // Retry sweep — re-fetch any employee whose row count differs by a
  // material amount between the two pipelines. Sleeps 60s before the
  // retry to let Google's per-minute quota window roll over. Only retries
  // the side that came back empty.
  console.log(`Checking for fetch errors and retrying empties…\n`);
  for (const emp of employees) {
    const cron = cronResults[emp.id];
    const a = analyticsData[emp.id];
    if (!cron || !a) continue;
    const cronEmpty = cron.monthOrders === 0 && cron.monthSale === 0;
    const analyticsEmpty = a.orders.length === 0;
    if (cronEmpty && !analyticsEmpty) {
      cronErrors.push({
        emp: `${emp.employeeId} ${emp.firstName}`,
        reason: cron.tab ? "tab found but no rows parsed (possible quota)" : "no tab matched",
      });
    }
    if (analyticsEmpty && !cronEmpty) {
      analyticsErrors.push({
        emp: `${emp.employeeId} ${emp.firstName}`,
        reason: a.error || "no error reported (possible quota)",
      });
    }
  }

  if (cronErrors.length > 0 || analyticsErrors.length > 0) {
    console.log(`Retrying ${cronErrors.length + analyticsErrors.length} sheets after a 90s quota cooldown…`);
    await new Promise((r) => setTimeout(r, 90_000));

    // Retry analytics-side failures one at a time to avoid bursts.
    for (const e of analyticsErrors) {
      const emp = employees.find(
        (em) => `${em.employeeId} ${em.firstName}` === e.emp,
      );
      if (!emp) continue;
      const fresh = await fetchAllSheetAnalytics(
        [{ userId: emp.id, sheetUrl: emp.googleSheetUrl! }],
        MONTH,
        YEAR,
      );
      if (fresh[emp.id] && fresh[emp.id].orders.length > 0) {
        analyticsData[emp.id] = fresh[emp.id];
        console.log(`  ✓ recovered analytics for ${e.emp}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    // Retry cron-side failures.
    for (const e of cronErrors) {
      const emp = employees.find(
        (em) => `${em.employeeId} ${em.firstName}` === e.emp,
      );
      if (!emp) continue;
      const fresh = await cronReadMonth(sheets, emp.googleSheetUrl!, MONTH, YEAR);
      if (fresh.monthSale > 0) {
        cronResults[emp.id] = fresh;
        console.log(`  ✓ recovered cron for ${e.emp}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log();
  }

  for (const emp of employees) {
    const cron = cronResults[emp.id];
    const a = analyticsData[emp.id];
    if (!cron || !a) continue;

    // Re-aggregate analytics orders identically to the API route.
    let aSale = 0;
    let aCost = 0;
    const seen = new Set<string>();
    let aOrders = 0;
    for (const o of a.orders) {
      aSale += o.price;
      aCost += o.cost;
      if (!o.orderId || !seen.has(o.orderId)) {
        aOrders++;
        if (o.orderId) seen.add(o.orderId);
      }
    }
    const aProfit = aSale - aCost;

    const match =
      cron.monthOrders === aOrders &&
      Math.abs(cron.monthSale - aSale) < 0.01 &&
      Math.abs(cron.monthCost - aCost) < 0.01 &&
      Math.abs(cron.monthProfit - aProfit) < 0.01;

    rows.push({
      emp: `${emp.employeeId} ${emp.firstName} ${emp.lastName || ""}`.trim(),
      team: emp.department?.name || "Unknown",
      cronOrders: cron.monthOrders,
      cronSale: cron.monthSale,
      cronCost: cron.monthCost,
      cronProfit: cron.monthProfit,
      cronTab: cron.tab,
      aOrders,
      aSale,
      aCost,
      aProfit,
      match,
    });
  }

  // ─── Per-team output ───────────────────────────────────────────────
  const byTeam: Record<string, Row[]> = {};
  for (const r of rows) {
    byTeam[r.team] = byTeam[r.team] || [];
    byTeam[r.team].push(r);
  }

  let totalMismatches = 0;
  for (const [team, teamRows] of Object.entries(byTeam)) {
    console.log(`${team}`);
    console.log("─".repeat(team.length));
    for (const r of teamRows) {
      const sym = r.match ? "✓" : "✗";
      if (!r.match) totalMismatches++;
      console.log(
        `  ${sym} ${r.emp.padEnd(32)} ` +
          `cron: ${String(r.cronOrders).padStart(3)} ord · $${r.cronSale.toFixed(2).padStart(9)} · $${r.cronProfit.toFixed(2).padStart(9)} gp   ` +
          `analytics: ${String(r.aOrders).padStart(3)} ord · $${r.aSale.toFixed(2).padStart(9)} · $${r.aProfit.toFixed(2).padStart(9)} gp`,
      );
      if (!r.match) {
        console.log(
          `    Δ orders=${r.aOrders - r.cronOrders}  Δ sale=$${(r.aSale - r.cronSale).toFixed(2)}  Δ cost=$${(r.aCost - r.cronCost).toFixed(2)}  Δ profit=$${(r.aProfit - r.cronProfit).toFixed(2)}`,
        );
      }
    }

    const tCO = teamRows.reduce((s, r) => s + r.cronOrders, 0);
    const tCSale = teamRows.reduce((s, r) => s + r.cronSale, 0);
    const tCProfit = teamRows.reduce((s, r) => s + r.cronProfit, 0);
    const tAO = teamRows.reduce((s, r) => s + r.aOrders, 0);
    const tASale = teamRows.reduce((s, r) => s + r.aSale, 0);
    const tAProfit = teamRows.reduce((s, r) => s + r.aProfit, 0);
    const teamMatch =
      tCO === tAO &&
      Math.abs(tCSale - tASale) < 0.01 &&
      Math.abs(tCProfit - tAProfit) < 0.01;
    console.log(
      `  ${teamMatch ? "✓" : "✗"} ${"TEAM TOTAL".padEnd(32)} ` +
        `cron: ${String(tCO).padStart(3)} ord · $${tCSale.toFixed(2).padStart(9)} · $${tCProfit.toFixed(2).padStart(9)} gp   ` +
        `analytics: ${String(tAO).padStart(3)} ord · $${tASale.toFixed(2).padStart(9)} · $${tAProfit.toFixed(2).padStart(9)} gp`,
    );
    console.log();
  }

  // ─── Summary ───────────────────────────────────────────────────────
  console.log("─".repeat(70));
  if (totalMismatches === 0) {
    console.log(`✓ All ${rows.length} employees match across both pipelines.`);
    console.log(`  Daily-report cron and analytics service produce identical numbers.`);
  } else {
    console.log(
      `✗ ${totalMismatches} of ${rows.length} employees show a mismatch.`,
    );
    console.log(`  Investigate the rows marked with ✗ above.`);
  }
  console.log();

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Verify failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
