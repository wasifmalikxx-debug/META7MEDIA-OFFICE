import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { fetchSheetAnalytics, SheetOrderRow } from "@/lib/services/google-sheets.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface DuplicateFlag {
  type: "EXACT_DUPLICATE" | "SAME_DATE_PRICE" | "SAME_SHOP_DATE" | "SUSPICIOUS_PATTERN";
  message: string;
  rows: number[]; // 1-based row indices
  severity: "HIGH" | "MEDIUM" | "LOW";
}

interface EmployeeAudit {
  employeeId: string;
  name: string;
  sheetUrl: string;
  tabName: string | null;
  totalOrders: number;
  totalProfit: number;
  sheetAfterTax: number;
  calculatedAfterTax: number;
  mismatch: boolean;
  flags: DuplicateFlag[];
  error: string | null;
}

function auditOrders(orders: SheetOrderRow[]): DuplicateFlag[] {
  const flags: DuplicateFlag[] = [];

  // 1. Exact duplicates — same shop, date, price, cost, profit
  const seen = new Map<string, number[]>();
  orders.forEach((order, i) => {
    const key = `${order.shopName}|${order.orderDate}|${order.price}|${order.cost}|${order.profit}`;
    const existing = seen.get(key) || [];
    existing.push(i + 2); // +2 because header is row 1, data starts row 2
    seen.set(key, existing);
  });
  for (const [key, rowIndices] of seen) {
    if (rowIndices.length > 1) {
      const parts = key.split("|");
      flags.push({
        type: "EXACT_DUPLICATE",
        message: `Exact duplicate: ${parts[0]} on ${parts[1]} — $${parts[2]} price, $${parts[4]} profit (${rowIndices.length} times)`,
        rows: rowIndices,
        severity: "HIGH",
      });
    }
  }

  // 2. Same date + same price (different shops — possible copy-paste)
  const datePriceMap = new Map<string, { rows: number[]; shops: Set<string> }>();
  orders.forEach((order, i) => {
    if (order.price <= 0) return;
    const key = `${order.orderDate}|${order.price.toFixed(2)}`;
    const existing = datePriceMap.get(key) || { rows: [], shops: new Set() };
    existing.rows.push(i + 2);
    existing.shops.add(order.shopName);
    datePriceMap.set(key, existing);
  });
  for (const [key, { rows, shops }] of datePriceMap) {
    // Only flag if same price appears 3+ times on same date
    if (rows.length >= 3) {
      const parts = key.split("|");
      flags.push({
        type: "SAME_DATE_PRICE",
        message: `Same price $${parts[1]} appears ${rows.length}× on ${parts[0]} across ${shops.size} shop(s)`,
        rows,
        severity: rows.length >= 5 ? "HIGH" : "MEDIUM",
      });
    }
  }

  // 3. Same shop + same date — multiple orders from one shop in one day
  const shopDateMap = new Map<string, number[]>();
  orders.forEach((order, i) => {
    const key = `${order.shopName.toUpperCase()}|${order.orderDate}`;
    const existing = shopDateMap.get(key) || [];
    existing.push(i + 2);
    shopDateMap.set(key, existing);
  });
  for (const [key, rowIndices] of shopDateMap) {
    if (rowIndices.length >= 4) {
      const parts = key.split("|");
      flags.push({
        type: "SAME_SHOP_DATE",
        message: `${parts[0]} has ${rowIndices.length} orders on ${parts[1]} — verify if legitimate`,
        rows: rowIndices,
        severity: "MEDIUM",
      });
    }
  }

  // 4. Suspicious patterns — negative profits, zero-cost orders with profit, unrealistic margins
  orders.forEach((order, i) => {
    const row = i + 2;
    // Profit higher than price (impossible margin)
    if (order.profit > order.price && order.price > 0) {
      flags.push({
        type: "SUSPICIOUS_PATTERN",
        message: `Row ${row}: Profit ($${order.profit}) > Price ($${order.price}) for ${order.shopName} — impossible margin`,
        rows: [row],
        severity: "HIGH",
      });
    }
    // Zero cost but positive profit
    if (order.cost === 0 && order.profit > 5) {
      flags.push({
        type: "SUSPICIOUS_PATTERN",
        message: `Row ${row}: Zero cost but $${order.profit} profit for ${order.shopName} on ${order.orderDate}`,
        rows: [row],
        severity: "MEDIUM",
      });
    }
    // Negative after-tax (someone might subtract to hide income or it's a return)
    if (order.afterTax < -50) {
      flags.push({
        type: "SUSPICIOUS_PATTERN",
        message: `Row ${row}: Large negative after-tax ($${order.afterTax}) for ${order.shopName} on ${order.orderDate}`,
        rows: [row],
        severity: "LOW",
      });
    }
  });

  // 5. Orders outside the target month (date manipulation)
  // Try to detect orders that don't belong to the month
  const monthDates = new Map<string, number>();
  orders.forEach((order) => {
    const dateStr = order.orderDate.trim();
    // Try to extract month from various date formats
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      const m = parsed.getMonth() + 1;
      monthDates.set(String(m), (monthDates.get(String(m)) || 0) + 1);
    }
  });

  return flags;
}

/**
 * GET /api/sheets-audit?month=3&year=2026
 * Reads ALL Etsy employee sheets and flags suspicious entries
 */
export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") return error("CEO only", 403);

  const url = new URL(request.url);
  const month = parseInt(url.searchParams.get("month") || "3");
  const year = parseInt(url.searchParams.get("year") || "2026");

  try {
    // Get all Etsy employees with sheet URLs
    const employees = await prisma.user.findMany({
      where: {
        status: { in: ["HIRED", "PROBATION"] },
        role: { not: "SUPER_ADMIN" },
        employeeId: { startsWith: "EM-" },
        googleSheetUrl: { not: null },
      },
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        googleSheetUrl: true,
      },
      orderBy: { employeeId: "asc" },
    });

    const audits: EmployeeAudit[] = [];
    let totalFlags = 0;
    let highSeverityCount = 0;

    // Process in batches of 3 (respect Google API rate limits)
    const batchSize = 3;
    for (let i = 0; i < employees.length; i += batchSize) {
      const batch = employees.slice(i, i + batchSize);
      const promises = batch.map(async (emp) => {
        const name = `${emp.firstName} ${emp.lastName || ""}`.trim();
        const sheetUrl = emp.googleSheetUrl!;

        const data = await fetchSheetAnalytics(sheetUrl, month, year);

        if (data.error) {
          return {
            employeeId: emp.employeeId,
            name,
            sheetUrl,
            tabName: data.tabName,
            totalOrders: 0,
            totalProfit: 0,
            sheetAfterTax: 0,
            calculatedAfterTax: 0,
            mismatch: false,
            flags: [],
            error: data.error,
          } as EmployeeAudit;
        }

        const flags = auditOrders(data.orders);
        const calculatedAfterTax = data.orders.reduce((sum, o) => sum + o.afterTax, 0);
        const calculatedProfit = data.orders.reduce((sum, o) => sum + o.profit, 0);
        const sheetAfterTax = data.summary.afterTax;

        // Check if sheet summary matches row-by-row calculation
        const mismatch = Math.abs(sheetAfterTax - calculatedAfterTax) > 1;
        if (mismatch) {
          flags.push({
            type: "SUSPICIOUS_PATTERN",
            message: `AFTER TAX mismatch: Sheet says $${sheetAfterTax.toFixed(2)} but rows sum to $${calculatedAfterTax.toFixed(2)} (diff: $${Math.abs(sheetAfterTax - calculatedAfterTax).toFixed(2)})`,
            rows: [],
            severity: "HIGH",
          });
        }

        totalFlags += flags.length;
        highSeverityCount += flags.filter((f) => f.severity === "HIGH").length;

        return {
          employeeId: emp.employeeId,
          name,
          sheetUrl,
          tabName: data.tabName,
          totalOrders: data.orders.length,
          totalProfit: calculatedProfit,
          sheetAfterTax,
          calculatedAfterTax: Math.round(calculatedAfterTax * 100) / 100,
          mismatch,
          flags,
          error: null,
        } as EmployeeAudit;
      });

      const results = await Promise.all(promises);
      audits.push(...results);
    }

    // Sort: most flags first
    audits.sort((a, b) => b.flags.length - a.flags.length);

    return json({
      month,
      year,
      employeesChecked: audits.length,
      totalFlags,
      highSeverityCount,
      summary: audits.map((a) => ({
        employeeId: a.employeeId,
        name: a.name,
        orders: a.totalOrders,
        profit: `$${a.totalProfit.toFixed(2)}`,
        afterTax: `$${a.sheetAfterTax.toFixed(2)}`,
        flags: a.flags.length,
        highFlags: a.flags.filter((f) => f.severity === "HIGH").length,
        mismatch: a.mismatch,
        error: a.error,
      })),
      details: audits,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
