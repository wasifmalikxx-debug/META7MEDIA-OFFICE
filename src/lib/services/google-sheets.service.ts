/**
 * Google Sheets Integration Service
 *
 * Reads employee profit data from their individual Google Sheets.
 * Each employee has a sheet with monthly tabs (e.g., "MARCH - 2K26")
 * GROSS PROFIT is in cell Y10 of each monthly tab.
 */

import { google } from "googleapis";
import path from "path";

// Month tab name format: "MARCH - 2K26" for March 2026
const MONTH_NAMES = [
  "JAN", "FEB", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC",
];

function getMonthTabName(month: number, year: number): string {
  const monthName = MONTH_NAMES[month - 1];
  const shortYear = `2K${String(year).slice(2)}`;
  return `${monthName} - ${shortYear}`;
}

// Alternative tab name formats to try
function getAlternativeTabNames(month: number, year: number): string[] {
  const monthName = MONTH_NAMES[month - 1];
  const shortYear = `2K${String(year).slice(2)}`;
  const fullMonthNames = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  ];
  return [
    `${monthName} - ${shortYear}`,           // MARCH - 2K26
    `${fullMonthNames[month - 1]} - ${shortYear}`, // MARCH - 2K26 (already same for March)
    `${monthName} ${shortYear}`,              // MARCH 2K26
    `${monthName}-${shortYear}`,              // MARCH-2K26
    `${monthName} - ${year}`,                 // MARCH - 2026
    `${monthName} ${year}`,                   // MARCH 2026
  ];
}

async function getAuthClient() {
  const credPath = path.join(process.cwd(), "google-credentials.json");
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

    // Try to find the correct monthly tab
    const tabNames = getAlternativeTabNames(month, year);
    let matchedTab: string | null = null;

    for (const tabName of tabNames) {
      const found = sheetTabs.find(
        (t) => t.trim().toUpperCase() === tabName.toUpperCase()
      );
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
  orderDate: string; // raw date string from column D
  price: number;     // column G (USD)
  afterTax: number;  // column H
  cost: number;      // column I
  profit: number;    // column J
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
 * Fetch ALL order rows + analytics summary from an employee's sheet for a month.
 * Reads columns A-J for order data and the analytics area (W-Y) for summary totals.
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

    // Get tab names
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetTabs = spreadsheet.data.sheets?.map((s) => s.properties?.title || "") || [];

    const tabNames = getAlternativeTabNames(month, year);
    let matchedTab: string | null = null;
    for (const tabName of tabNames) {
      const found = sheetTabs.find((t) => t.trim().toUpperCase() === tabName.toUpperCase());
      if (found) { matchedTab = found; break; }
    }
    if (!matchedTab) {
      return { ...empty, error: `Tab not found. Tried: ${tabNames[0]}` };
    }

    // Batch read: order data (A:J) and analytics area (V:AD rows 1-15)
    const ranges = [
      `'${matchedTab}'!A:J`,
      `'${matchedTab}'!V1:AD15`,
    ];

    const batchResponse = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges,
    });

    const valueRanges = batchResponse.data.valueRanges || [];
    const orderRows = valueRanges[0]?.values || [];
    const analyticsRows = valueRanges[1]?.values || [];

    // Detect column indices from header row
    const headerRow = orderRows[0] || [];
    const colIndex: Record<string, number> = {};
    for (let c = 0; c < headerRow.length; c++) {
      const h = String(headerRow[c] || "").trim().toUpperCase();
      if (h.includes("SHOP") || h.includes("STORE")) colIndex.shop = colIndex.shop ?? c;
      if (h.includes("ORDER DATE") || h === "DATE") colIndex.date = colIndex.date ?? c;
      if (h.includes("PRICE") || h.includes("SALE")) colIndex.price = colIndex.price ?? c;
      if (h.includes("AFTER TAX")) colIndex.afterTax = colIndex.afterTax ?? c;
      if (h === "COST" || h.includes("COST")) colIndex.cost = colIndex.cost ?? c;
      if (h === "PROFIT" || h.includes("PROFIT")) colIndex.profit = colIndex.profit ?? c;
    }
    // Fallbacks if headers not found
    const shopCol = colIndex.shop ?? 0;
    const dateCol = colIndex.date ?? 3;
    const priceCol = colIndex.price ?? 6;
    const afterTaxCol = colIndex.afterTax ?? 7;
    const costCol = colIndex.cost ?? 8;
    const profitCol = colIndex.profit ?? 9;

    // Parse order rows (skip header row)
    const orders: SheetOrderRow[] = [];
    for (let i = 1; i < orderRows.length; i++) {
      const row = orderRows[i];
      if (!row || row.length < 5) continue;

      const shopName = String(row[shopCol] || "").trim();
      const orderDate = String(row[dateCol] || "").trim();
      const price = parseFloat(String(row[priceCol] || "0").replace(/[$,\s]/g, "")) || 0;
      const afterTax = parseFloat(String(row[afterTaxCol] || "0").replace(/[$,\s]/g, "")) || 0;
      const cost = parseFloat(String(row[costCol] || "0").replace(/[$,\s]/g, "")) || 0;
      const profit = parseFloat(String(row[profitCol] || "0").replace(/[$,\s]/g, "")) || 0;

      // Skip rows without a shop name or date (likely empty/totals)
      if (!shopName || !orderDate) continue;
      // Skip header-like rows
      if (shopName.toUpperCase().includes("SHOP") || shopName.toUpperCase().includes("STORE NAME")) continue;

      orders.push({ shopName, orderDate, price, afterTax, cost, profit });
    }

    // Parse analytics summary — search for labels in analytics area
    const summary: SheetAnalyticsSummary = { totalSale: 0, totalCost: 0, grossProfit: 0, afterTax: 0 };
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
