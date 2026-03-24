/**
 * Google Sheets Integration Service
 *
 * Reads employee profit data from their individual Google Sheets.
 * Each employee has a sheet with monthly tabs (e.g., "MARCH - 2K26")
 * GROSS PROFIT is in cell Y9 of each monthly tab.
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
 * Reads cell Y9 from the monthly tab
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

    // Read GROSS PROFIT from cell Y9
    const range = `'${matchedTab}'!Y9`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    const rawValue = response.data.values?.[0]?.[0];
    if (!rawValue) {
      return { profit: null, error: "Cell Y9 is empty", tabName: matchedTab };
    }

    // Parse the profit value — remove $, commas, etc.
    const cleanValue = String(rawValue).replace(/[$,\s]/g, "");
    const profit = parseFloat(cleanValue);

    if (isNaN(profit)) {
      return { profit: null, error: `Cannot parse value: ${rawValue}`, tabName: matchedTab };
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
