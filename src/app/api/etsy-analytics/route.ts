import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import {
  fetchAllSheetAnalytics,
  type EmployeeSheetData,
  type SheetOrderRow,
} from "@/lib/services/google-sheets.service";
import { resolveEtsyScope } from "@/lib/etsy-team-scope";

// ─── In-memory cache (5 minutes) ──────────────────────────────────

interface CacheEntry {
  data: any;
  timestamp: number;
}

const analyticsCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string) {
  const entry = analyticsCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  analyticsCache.delete(key);
  return null;
}

function setCache(key: string, data: any) {
  analyticsCache.set(key, { data, timestamp: Date.now() });
}

// ─── Types ─────────────────────────────────────────────────────────

interface EmployeeAnalytics {
  userId: string;
  name: string;
  employeeId: string;
  shopNames: string[];
  totalSales: number;
  totalCost: number;
  profit: number;
  afterTax: number;
  orders: number;
  avgOrderValue: number;
  error: string | null;
}

interface ShopAnalytics {
  shopName: string;
  orders: number;
  totalSales: number;
  totalCost: number;
  profit: number;
}

interface DailySales {
  date: string;
  sales: number;
  orders: number;
}

interface QuickStats {
  todayOrders: number;
  todaySales: number;
  yesterdayOrders: number;
  yesterdaySales: number;
  weekOrders: number;
  weekSales: number;
  bestEmployee: string;
  bestEmployeeProfit: number;
  bestShop: string;
  bestShopProfit: number;
  highestOrder: number;
  highestOrderShop: string;
  highestOrderDate: string;
}

// ─── GET handler ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  // CEO views any team's analytics; Etsy PARTNERs (Awais, Mubeen) view their
  // own team's analytics. MANAGER (Izaan) is EXPLICITLY EXCLUDED — he's a
  // team lead, not a partner, and Wasif wants analytics scoped to people who
  // own P&L for their team. The sidebar hides the tab from him and the page
  // redirects him out; this is the server-side backstop in case he hits the
  // API directly. Allowlist mirrors /etsy-analytics page.tsx exactly.
  if (role !== "SUPER_ADMIN" && role !== "PARTNER") {
    return error("Forbidden", 403);
  }

  const { searchParams } = new URL(request.url);
  // Default to PKT month/year
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(pkt.getUTCFullYear()));

  if (month < 1 || month > 12 || year < 2020 || year > 2100) {
    return error("Invalid month or year");
  }

  // Resolve scope. Honors ?team= for SUPER_ADMIN; partners and managers are
  // pinned to their own team regardless of what they pass.
  const scope = await resolveEtsyScope(role, session.user.id, searchParams.get("team"));
  if (!scope) {
    if (role === "PARTNER") return error("Analytics is only available for Etsy teams", 403);
    return error("Etsy department not found");
  }
  const scopedDept = { id: scope.departmentId, name: scope.departmentName };

  // Cache key MUST include the scope so Awais doesn't get Mubeen's cached data.
  const cacheKey = `etsy-analytics-${month}-${year}-${scopedDept.id}`;
  const cached = getCached(cacheKey);
  if (cached) return json(cached);

  // Get all employees on the scoped department who have sheets.
  const employees = await prisma.user.findMany({
    where: {
      departmentId: scopedDept.id,
      status: { in: ["HIRED", "PROBATION"] },
      googleSheetUrl: { not: null },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      googleSheetUrl: true,
    },
  });

  const employeeSheets = employees
    .filter((e) => e.googleSheetUrl)
    .map((e) => ({ userId: e.id, sheetUrl: e.googleSheetUrl! }));

  if (employeeSheets.length === 0) {
    return json({
      month,
      year,
      overview: { totalSales: 0, totalCost: 0, grossProfit: 0, afterTax: 0, totalOrders: 0, avgOrderValue: 0 },
      employees: [],
      shops: [],
      dailySales: [],
      quickStats: null,
    });
  }

  // Fetch all sheet data
  const sheetData = await fetchAllSheetAnalytics(employeeSheets, month, year);

  // ─── Aggregation ────────────────────────────────────────────────
  // Rules (CEO directive locked in May 19 2026 — see
  // memory/feedback_profit_rules.md):
  //
  //   • PROFIT ≡ GROSS = price − cost.  CEO wants the analytics page
  //     to show pre-Etsy-fee profit. Same formula as the WhatsApp
  //     daily report. The bonus calc uses AFTER TAX separately —
  //     do NOT unify them.
  //   • Order count is unique Order IDs, not row count. Multi-SKU line
  //     items belong to one Etsy transaction. Rows with no Order ID can't
  //     be deduped — they always count as 1.
  //   • Row sums are the source of truth. The sheet's TOTAL SALE / TOTAL
  //     COST / GROSS PROFIT summary cells are stale on every audited sheet.
  //
  // Cross-employee Order ID collisions are avoided by namespacing the
  // canonical dedup key with the employee's id. Rows without an Order ID
  // get a per-row synthetic id so they remain distinct in downstream
  // aggregations.

  const employeeAnalytics: EmployeeAnalytics[] = [];
  type CanonicalOrder = SheetOrderRow & { employeeName: string; canonicalId: string };
  const allOrders: CanonicalOrder[] = [];
  let syntheticIdCounter = 0;

  for (const emp of employees) {
    const data = sheetData[emp.id];
    if (!data) continue;

    const name = `${emp.firstName} ${emp.lastName}`;
    const shopNames = [...new Set(data.orders.map((o) => o.shopName))];

    let totalSales = 0;
    let totalCost = 0;
    let afterTax = 0;
    const empSeenOrderIds = new Set<string>();
    let empOrders = 0;

    for (const order of data.orders) {
      totalSales += order.price;
      totalCost += order.cost;
      afterTax += order.afterTax;
      if (!order.orderId || !empSeenOrderIds.has(order.orderId)) {
        empOrders++;
        if (order.orderId) empSeenOrderIds.add(order.orderId);
      }
    }

    // GROSS profit = Sale − Cost (CEO directive — see
    // memory/feedback_profit_rules.md). `afterTax` stays exposed on
    // the response so the UI can show "Etsy fees = sale − afterTax"
    // separately if needed, but the headline profit number is gross.
    const profit = totalSales - totalCost;

    employeeAnalytics.push({
      userId: emp.id,
      name,
      employeeId: emp.employeeId,
      shopNames,
      totalSales,
      totalCost,
      profit,
      afterTax, // exposed so UI can show Etsy fees = totalSales − afterTax
      orders: empOrders,
      avgOrderValue: empOrders > 0 ? totalSales / empOrders : 0,
      error: data.error,
    });

    // Stamp each raw row with the employee's id + Order ID (or a synthetic
    // per-row id if missing). Downstream shop / daily aggregations use this
    // single field for dedup so the same multi-SKU order isn't counted
    // twice in the shop totals or daily totals.
    for (const order of data.orders) {
      const canonicalId = order.orderId
        ? `${emp.id}:${order.orderId}`
        : `${emp.id}:r${syntheticIdCounter++}`;
      allOrders.push({ ...order, employeeName: name, canonicalId });
    }
  }

  // Sort employees by gross profit (highest first).
  employeeAnalytics.sort((a, b) => b.profit - a.profit);

  // Overview — straight sum across per-employee aggregates.
  const overview = {
    totalSales: employeeAnalytics.reduce((s, e) => s + e.totalSales, 0),
    totalCost: employeeAnalytics.reduce((s, e) => s + e.totalCost, 0),
    grossProfit: employeeAnalytics.reduce((s, e) => s + e.profit, 0),
    afterTax: employeeAnalytics.reduce((s, e) => s + e.afterTax, 0),
    totalOrders: employeeAnalytics.reduce((s, e) => s + e.orders, 0),
    avgOrderValue: 0,
  };
  overview.avgOrderValue =
    overview.totalOrders > 0 ? overview.totalSales / overview.totalOrders : 0;

  // ─── Shop analytics ─────────────────────────────────────────────
  // Per-shop totals: sum every row's price/cost, dedupe orders by
  // canonical id. GROSS profit = sale − cost (CEO directive).
  const shopAgg = new Map<
    string,
    {
      shopName: string;
      totalSales: number;
      totalCost: number;
      orderSet: Set<string>;
    }
  >();
  for (const order of allOrders) {
    let entry = shopAgg.get(order.shopName);
    if (!entry) {
      entry = {
        shopName: order.shopName,
        totalSales: 0,
        totalCost: 0,
        orderSet: new Set(),
      };
      shopAgg.set(order.shopName, entry);
    }
    entry.totalSales += order.price;
    entry.totalCost += order.cost;
    entry.orderSet.add(order.canonicalId);
  }
  const shops: ShopAnalytics[] = [...shopAgg.values()]
    .map((s) => ({
      shopName: s.shopName,
      orders: s.orderSet.size,
      totalSales: s.totalSales,
      totalCost: s.totalCost,
      profit: s.totalSales - s.totalCost,
    }))
    .sort((a, b) => b.profit - a.profit);

  // ─── Daily sales ────────────────────────────────────────────────
  // Per-day: same dedup pattern. Drops rows whose date string we can't
  // normalize into the expected month (defensive — bad dates would
  // otherwise pollute the chart).
  const dailyAgg = new Map<
    string,
    { date: string; sales: number; orderSet: Set<string> }
  >();
  for (const order of allOrders) {
    const dateStr = normalizeDate(order.orderDate, month, year);
    if (!dateStr) continue;
    let entry = dailyAgg.get(dateStr);
    if (!entry) {
      entry = { date: dateStr, sales: 0, orderSet: new Set() };
      dailyAgg.set(dateStr, entry);
    }
    entry.sales += order.price;
    entry.orderSet.add(order.canonicalId);
  }
  const dailySales: DailySales[] = [...dailyAgg.values()]
    .map((d) => ({ date: d.date, sales: d.sales, orders: d.orderSet.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // dailyMap retained for the quick-stats lookup below — keep it in sync.
  const dailyMap = new Map<string, DailySales>();
  for (const d of dailySales) dailyMap.set(d.date, d);

  // Quick stats — use PKT date
  const todayPkt = new Date(Date.now() + 5 * 60 * 60_000);
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(todayPkt.getUTCDate()).padStart(2, "0")}`;
  const yesterdayPkt = new Date(todayPkt.getTime() - 24 * 60 * 60_000);
  const yesterdayStr = `${yesterdayPkt.getUTCFullYear()}-${String(yesterdayPkt.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterdayPkt.getUTCDate()).padStart(2, "0")}`;

  // Week: last 7 days
  const weekStart = new Date(todayPkt);
  weekStart.setDate(weekStart.getDate() - 6);

  const todayData = dailyMap.get(todayStr);
  const yesterdayData = dailyMap.get(yesterdayStr);

  let weekOrders = 0;
  let weekSales = 0;
  for (const [dateStr, data] of dailyMap) {
    const d = new Date(dateStr);
    if (d >= weekStart && d <= todayPkt) {
      weekOrders += data.orders;
      weekSales += data.sales;
    }
  }

  // Best employee
  const bestEmp = employeeAnalytics.length > 0 ? employeeAnalytics[0] : null;

  // Best shop
  const bestShop = shops.length > 0 ? shops[0] : null;

  // Highest single order
  let highestOrder = 0;
  let highestOrderShop = "";
  let highestOrderDate = "";
  for (const order of allOrders) {
    if (order.price > highestOrder) {
      highestOrder = order.price;
      highestOrderShop = order.shopName;
      highestOrderDate = order.orderDate;
    }
  }

  const quickStats: QuickStats = {
    todayOrders: todayData?.orders || 0,
    todaySales: todayData?.sales || 0,
    yesterdayOrders: yesterdayData?.orders || 0,
    yesterdaySales: yesterdayData?.sales || 0,
    weekOrders,
    weekSales,
    bestEmployee: bestEmp?.name || "N/A",
    bestEmployeeProfit: bestEmp?.profit || 0,
    bestShop: bestShop?.shopName || "N/A",
    bestShopProfit: bestShop?.profit || 0,
    highestOrder,
    highestOrderShop,
    highestOrderDate,
  };

  const result = {
    month,
    year,
    overview,
    employees: employeeAnalytics,
    shops,
    dailySales,
    quickStats,
  };

  setCache(cacheKey, result);
  return json(result);
}

// ─── Date parsing helper ───────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function normalizeDate(dateStr: string, expectedMonth: number, expectedYear: number): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();

  // Format: "1 Mar", "25 Mar", "3 March" (day + month abbreviation, no year)
  const dayMonthMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)$/);
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1]);
    const monthNum = MONTH_NAMES[dayMonthMatch[2].toLowerCase()];
    if (monthNum === expectedMonth && day >= 1 && day <= 31) {
      return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Format: "Mar 1", "March 25" (month + day)
  const monthDayMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (monthDayMatch) {
    const monthNum = MONTH_NAMES[monthDayMatch[1].toLowerCase()];
    const day = parseInt(monthDayMatch[2]);
    if (monthNum === expectedMonth && day >= 1 && day <= 31) {
      return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Format: "1 Mar 2026", "25 March 2026"
  const dayMonthYearMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dayMonthYearMatch) {
    const day = parseInt(dayMonthYearMatch[1]);
    const monthNum = MONTH_NAMES[dayMonthYearMatch[2].toLowerCase()];
    const yr = parseInt(dayMonthYearMatch[3]);
    if (monthNum === expectedMonth && yr === expectedYear) {
      return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Format: MM/DD/YYYY or DD/MM/YYYY
  const slashMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1]);
    const p2 = parseInt(slashMatch[2]);
    const p3 = parseInt(slashMatch[3]);
    const fullYear = p3 < 100 ? 2000 + p3 : p3;
    if (p1 === expectedMonth && fullYear === expectedYear) {
      return `${expectedYear}-${String(p1).padStart(2, "0")}-${String(p2).padStart(2, "0")}`;
    }
    if (p2 === expectedMonth && fullYear === expectedYear) {
      return `${expectedYear}-${String(p2).padStart(2, "0")}-${String(p1).padStart(2, "0")}`;
    }
  }

  // Try direct Date parse as fallback
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime()) && parsed.getMonth() + 1 === expectedMonth) {
    return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }

  return null;
}
