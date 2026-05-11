/**
 * Google Sheets Integration Service
 *
 * Reads employee profit data from their individual Google Sheets.
 * Each employee has a sheet with monthly tabs (e.g., "MARCH - 2K26")
 * GROSS PROFIT is in cell Y10 of each monthly tab.
 */

import { google } from "googleapis";
import path from "path";
import fs from "fs";

// Month tab name format: "MARCH - 2K26" for March 2026
const MONTH_NAMES = [
  "JAN", "FEB", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC",
];

// All known month-name aliases. Partner sheets in the wild use a mix of
// abbreviated (APR-2K26), full (APRIL 2026), and historical formats. Every
// alias for a given month produces a candidate tab name; the matcher then
// fuzzy-compares with normalizeTabName below.
const MONTH_ALIASES: Record<number, string[]> = {
  1: ["JAN", "JANUARY"],
  2: ["FEB", "FEBRUARY"],
  3: ["MAR", "MARCH"],
  4: ["APR", "APRIL"],
  5: ["MAY"],
  6: ["JUN", "JUNE"],
  7: ["JUL", "JULY"],
  8: ["AUG", "AUGUST"],
  9: ["SEP", "SEPT", "SEPTEMBER"],
  10: ["OCT", "OCTOBER"],
  11: ["NOV", "NOVEMBER"],
  12: ["DEC", "DECEMBER"],
};

function getMonthTabName(month: number, year: number): string {
  const monthName = MONTH_NAMES[month - 1];
  const shortYear = `2K${String(year).slice(2)}`;
  return `${monthName} - ${shortYear}`;
}

// Alternative tab name formats to try. Returns every combination of
// (alias × year-format × dash-style) so a sheet that names its April tab
// "APR- 2K26", "APRIL 2026", or "April-2026" all resolve correctly.
export function getAlternativeTabNames(month: number, year: number): string[] {
  const aliases = MONTH_ALIASES[month] || [MONTH_NAMES[month - 1]];
  const shortYear = `2K${String(year).slice(2)}`;
  const yearForms = [shortYear, String(year)]; // "2K26" and "2026"
  const out: string[] = [];
  for (const name of aliases) {
    for (const yr of yearForms) {
      out.push(`${name} - ${yr}`); // "APR - 2K26"
      out.push(`${name} ${yr}`);   // "APR 2K26"
      out.push(`${name}-${yr}`);   // "APR-2K26"
    }
  }
  return out;
}

/**
 * Normalize a tab name for fuzzy comparison. Collapses whitespace around the
 * separator dash so all of these match each other:
 *   "MAY - 2K26", "MAY- 2K26", "MAY -2K26", "MAY-2K26", "May - 2k26", " MAY  -  2K26 "
 *
 * Without this, partners sometimes name their tabs with inconsistent spacing
 * (e.g. Nabeel's "May- 2K26") and the cron silently fails for them. Strict
 * tab-format compliance is brittle as more sheets get onboarded.
 */
export function normalizeTabName(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")  // collapse whitespace around any dash
    .replace(/\s+/g, " ");      // collapse internal whitespace
}

async function getAuthClient() {
  // Support env var (Vercel) or file (local dev)
  if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    return auth.getClient();
  }

  const credPath = path.join(process.cwd(), "google-credentials.json");
  if (!fs.existsSync(credPath)) {
    throw new Error("Google credentials not found. Set GOOGLE_CREDENTIALS env var or add google-credentials.json");
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return auth.getClient();
}

/**
 * Extract spreadsheet ID from a Google Sheets URL
 */
export function extractSheetId(url: string): string | null {
  // https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch GROSS PROFIT from an employee's Google Sheet for a specific month
 * Reads cell Y10 from the monthly tab
 */
export async function fetchProfitFromSheet(
  sheetUrl: string,
  month: number,
  year: number
): Promise<{ profit: number | null; error: string | null; tabName: string | null }> {
  try {
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) {
      return { profit: null, error: "Invalid Google Sheet URL", tabName: null };
    }

    const authClient = await getAuthClient();
    const sheets = google.sheets({ version: "v4", auth: authClient as any });

    // First, get all sheet/tab names
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetTabs = spreadsheet.data.sheets?.map((s) => s.properties?.title || "") || [];

    // Try to find the correct monthly tab. Use fuzzy comparison so tabs with
    // inconsistent dash/whitespace formatting (e.g. "May- 2K26") still match.
    const tabNames = getAlternativeTabNames(month, year);
    let matchedTab: string | null = null;

    for (const tabName of tabNames) {
      const target = normalizeTabName(tabName);
      const found = sheetTabs.find((t) => normalizeTabName(t) === target);
      if (found) {
        matchedTab = found;
        break;
      }
    }

    if (!matchedTab) {
      return {
        profit: null,
        error: `Tab not found. Tried: ${tabNames[0]}. Available tabs: ${sheetTabs.join(", ")}`,
        tabName: null,
      };
    }

    // Read the analytics area (V1:AD15) and search for "AFTER TAX" label
    // Layout varies between sheets — label could be in any column, value is always next column
    const range = `'${matchedTab}'!V1:AD15`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    const rows = response.data.values || [];
    let profit: number | null = null;

    for (const row of rows) {
      for (let col = 0; col < row.length; col++) {
        if (String(row[col]).trim().toUpperCase() === "AFTER TAX") {
          // Value is in the next column
          const rawValue = row[col + 1];
          if (rawValue) {
            const cleanValue = String(rawValue).replace(/[$,\s]/g, "");
            profit = parseFloat(cleanValue);
          }
          break;
        }
      }
      if (profit !== null) break;
    }

    if (profit === null || isNaN(profit)) {
      return { profit: null, error: "AFTER TAX value not found in analytics area", tabName: matchedTab };
    }

    return { profit, error: null, tabName: matchedTab };
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes("not found")) {
      return { profit: null, error: "Sheet not found or not shared with service account", tabName: null };
    }
    if (msg.includes("permission")) {
      return { profit: null, error: "No permission. Share the sheet with: meta7media-sheets@meta7media-office.iam.gserviceaccount.com", tabName: null };
    }
    return { profit: null, error: msg, tabName: null };
  }
}

// ─── Analytics Types ───────────────────────────────────────────────

export interface SheetOrderRow {
  shopName: string;
  orderDate: string; // raw date string from the date column
  price: number;     // SALE / PRICE column
  afterTax: number;  // AFTER TAX column (after Etsy fees)
  cost: number;      // COST column (supplier / AliExpress)
  profit: number;    // raw PROFIT column from the sheet — DO NOT TRUST as
                     // gross profit. In the Etsy template this column is
                     // (afterTax - cost), i.e. net-after-tax, not gross.
                     // Aggregators should compute gross as (price - cost).
  orderId: string;   // Order ID column when present (empty when missing).
                     // Used to dedupe multi-SKU line items belonging to the
                     // same Etsy transaction.
}

export interface SheetAnalyticsSummary {
  totalSale: number;
  totalCost: number;
  grossProfit: number;
  afterTax: number;
}

export interface EmployeeSheetData {
  orders: SheetOrderRow[];
  summary: SheetAnalyticsSummary;
  error: string | null;
  tabName: string | null;
}

/**
 * Fetch ALL order rows + summary cells from an employee's sheet for a month.
 *
 * Parsing rules (same as the daily-report cron — see audit-analytics-accuracy
 * for the discrepancy report this fixes):
 *
 *   - Reads `A:N` (not A:J). AE-style sheets put PROFIT at column K and
 *     Order ID can land in column M; the old A:J range silently missed them.
 *
 *   - Scans the first 5 rows for the actual header. Some partner sheets use
 *     Google's "Tables" feature which puts a `Table1_X` placeholder at A1
 *     and pushes the real headers down a row (AE-3). The old logic read
 *     headers from row 0 only and would have silently corrupted everything.
 *
 *   - Detects the Order ID column with five label variants so multi-SKU line
 *     items belonging to one Etsy order can be deduped downstream.
 *
 *   - Skips placeholder rows where the date is stamped but no price is
 *     logged yet (`rowSale <= 0`). Partners pre-stamp the date for new
 *     orders before filling in the rest — those rows are not orders.
 *
 *   - Returns the sheet's PROFIT column value AS-IS. Aggregators should NOT
 *     trust this column as gross profit — in the Etsy template it's actually
 *     (afterTax - cost). Compute gross profit as (price - cost) at the
 *     aggregation layer.
 *
 *   - Returns summary cells (TOTAL SALE / TOTAL COST / GROSS PROFIT / AFTER
 *     TAX) for diagnostics, but every audited sheet's summary cells are
 *     stale (formulas haven't been extended as new rows were added). Don't
 *     use these for display.
 */
export async function fetchSheetAnalytics(
  sheetUrl: string,
  month: number,
  year: number
): Promise<EmployeeSheetData> {
  const empty: EmployeeSheetData = {
    orders: [],
    summary: { totalSale: 0, totalCost: 0, grossProfit: 0, afterTax: 0 },
    error: null,
    tabName: null,
  };

  try {
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) return { ...empty, error: "Invalid Google Sheet URL" };

    const authClient = await getAuthClient();
    const sheets = google.sheets({ version: "v4", auth: authClient as any });

    // Resolve the month tab via fuzzy name match.
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetTabs = spreadsheet.data.sheets?.map((s) => s.properties?.title || "") || [];
    const candidateSet = new Set(
      getAlternativeTabNames(month, year).map(normalizeTabName),
    );
    const matchedTab = sheetTabs.find((t) => candidateSet.has(normalizeTabName(t))) || null;
    if (!matchedTab) {
      return { ...empty, error: `Tab not found for ${month}/${year}` };
    }

    // Step 1: pull the preview rows (A1:N5 — covers up to 4 rows of pre-
    // header gunk plus the header itself) and the summary area in one batch.
    const previewBatch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: [`'${matchedTab}'!A1:N5`, `'${matchedTab}'!V1:AD15`],
    });
    const previewRows = (previewBatch.data.valueRanges?.[0]?.values || []) as string[][];
    const analyticsRows = (previewBatch.data.valueRanges?.[1]?.values || []) as string[][];

    // Step 2: locate the real header row. Look for "ORDER DATE" or "DATE"
    // anywhere in the first 5 rows.
    let headerRowIdx = -1;
    for (let i = 0; i < previewRows.length; i++) {
      const row = (previewRows[i] || []).map((c) =>
        (c || "").toString().toLowerCase().trim(),
      );
      if (row.some((c) => c.includes("order date") || c === "date")) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) {
      return { ...empty, error: "No ORDER DATE header found in first 5 rows" };
    }

    const headers = (previewRows[headerRowIdx] || []).map((h) =>
      (h || "").toString().toLowerCase().trim(),
    );

    // Step 3: detect column indices. Note: `findIndex` returns -1 when
    // missing, which we use as a "column doesn't exist" sentinel below.
    const shopCol = headers.findIndex(
      (h) => h.includes("shop") || h.includes("store"),
    );
    const dateCol = headers.findIndex(
      (h) => h.includes("order date") || h === "date",
    );
    const priceCol = headers.findIndex(
      (h) => h.includes("price") || h.includes("sale"),
    );
    const afterTaxCol = headers.findIndex((h) => h.includes("after tax"));
    const costCol = headers.findIndex(
      (h) => h === "cost" || h.includes("cost"),
    );
    const profitCol = headers.findIndex(
      (h) => h === "profit" || h.includes("profit"),
    );
    // Order ID label varies widely across partner sheets. Match the same
    // five forms the daily-report cron looks for (the typo "Ordder #" is
    // real — see AE-5).
    const orderIdCol = headers.findIndex(
      (h) =>
        h.includes("order number") ||
        h.includes("order #") ||
        h.includes("ordder #") ||
        h.includes("order id") ||
        h === "ae order",
    );

    if (dateCol === -1) {
      return { ...empty, error: "No date column found" };
    }

    // Step 4: pull data rows starting one below the header (1-indexed in
    // the sheet, so headerRowIdx + 2). Read up to row 1000 — every audited
    // sheet stays well under 200 rows per month.
    const dataStartRow = headerRowIdx + 2;
    const dataResp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${matchedTab}'!A${dataStartRow}:N1000`,
    });
    const dataRows = (dataResp.data.values || []) as string[][];

    const orders: SheetOrderRow[] = [];
    for (const row of dataRows) {
      const orderDate = (row[dateCol] || "").toString().trim();
      if (!orderDate) continue;

      const price = priceCol >= 0
        ? parseFloat(String(row[priceCol] || "0").replace(/[$,\s]/g, "")) || 0
        : 0;
      // Skip placeholder rows — date stamped but no price entered yet.
      if (price <= 0) continue;

      const shopName = shopCol >= 0 ? (row[shopCol] || "").toString().trim() : "";
      const afterTax = afterTaxCol >= 0
        ? parseFloat(String(row[afterTaxCol] || "0").replace(/[$,\s]/g, "")) || 0
        : 0;
      const cost = costCol >= 0
        ? parseFloat(String(row[costCol] || "0").replace(/[$,\s]/g, "")) || 0
        : 0;
      const profit = profitCol >= 0
        ? parseFloat(String(row[profitCol] || "0").replace(/[$,\s]/g, "")) || 0
        : 0;
      const orderId = orderIdCol >= 0
        ? (row[orderIdCol] || "").toString().trim()
        : "";

      orders.push({
        shopName: shopName || "(unknown shop)",
        orderDate,
        price,
        afterTax,
        cost,
        profit,
        orderId,
      });
    }

    // Step 5: parse the V:AD summary area. Kept for diagnostics / sheet
    // hygiene checks; aggregation layer should NOT trust these values.
    const summary: SheetAnalyticsSummary = {
      totalSale: 0,
      totalCost: 0,
      grossProfit: 0,
      afterTax: 0,
    };
    const labelMap: Record<string, keyof SheetAnalyticsSummary> = {
      "TOTAL SALE": "totalSale",
      "TOTAL SALES": "totalSale",
      "TOTAL COST": "totalCost",
      "GROSS PROFIT": "grossProfit",
      "AFTER TAX": "afterTax",
    };
    for (const row of analyticsRows) {
      for (let col = 0; col < (row?.length || 0); col++) {
        const cellValue = String(row[col] || "").trim().toUpperCase();
        const key = labelMap[cellValue];
        if (key) {
          const rawValue = row[col + 1];
          if (rawValue) {
            const num = parseFloat(String(rawValue).replace(/[$,\s]/g, ""));
            if (!isNaN(num)) summary[key] = num;
          }
        }
      }
    }

    return { orders, summary, error: null, tabName: matchedTab };
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes("not found")) {
      return { ...empty, error: "Sheet not found or not shared with service account" };
    }
    if (msg.includes("permission")) {
      return { ...empty, error: "No permission. Share sheet with service account." };
    }
    return { ...empty, error: msg };
  }
}

/**
 * Fetch analytics for ALL employees in parallel (max 3 concurrent to respect rate limits)
 */
export async function fetchAllSheetAnalytics(
  employeeSheets: { userId: string; sheetUrl: string }[],
  month: number,
  year: number
): Promise<Record<string, EmployeeSheetData>> {
  const results: Record<string, EmployeeSheetData> = {};
  const batchSize = 3;

  for (let i = 0; i < employeeSheets.length; i += batchSize) {
    const batch = employeeSheets.slice(i, i + batchSize);
    const promises = batch.map(async ({ userId, sheetUrl }) => {
      results[userId] = await fetchSheetAnalytics(sheetUrl, month, year);
    });
    await Promise.all(promises);
  }

  return results;
}

/**
 * Fetch profits for multiple employees at once
 */
export async function fetchAllProfits(
  employeeSheets: { userId: string; sheetUrl: string }[],
  month: number,
  year: number
): Promise<Record<string, { profit: number | null; error: string | null; tabName: string | null }>> {
  const results: Record<string, { profit: number | null; error: string | null; tabName: string | null }> = {};

  // Fetch in parallel (max 5 concurrent)
  const batchSize = 5;
  for (let i = 0; i < employeeSheets.length; i += batchSize) {
    const batch = employeeSheets.slice(i, i + batchSize);
    const promises = batch.map(async ({ userId, sheetUrl }) => {
      const result = await fetchProfitFromSheet(sheetUrl, month, year);
      results[userId] = result;
    });
    await Promise.all(promises);
  }

  return results;
}
