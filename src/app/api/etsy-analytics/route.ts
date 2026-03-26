import { NextRequest } from "next/server";
import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import {
  fetchAllSheetAnalytics,
  type EmployeeSheetData,
  type SheetOrderRow,
} from "@/lib/services/google-sheets.service";

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
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const { searchParams } = new URL(request.url);
  // Default to PKT month/year
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(pkt.getUTCFullYear()));

  if (month < 1 || month > 12 || year < 2020 || year > 2100) {
    return error("Invalid month or year");
  }

  // Check cache
  const cacheKey = `etsy-analytics-${month}-${year}`;
  const cached = getCached(cacheKey);
  if (cached) return json(cached);

  // Get Etsy department
  const etsyDept = await prisma.department.findFirst({ where: { name: "Etsy" } });
  if (!etsyDept) return error("Etsy department not found");

  // Get all Etsy employees with sheets
  const employees = await prisma.user.findMany({
    where: {
      departmentId: etsyDept.id,
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

  // Build employee analytics
  const employeeAnalytics: EmployeeAnalytics[] = [];
  const allOrders: (SheetOrderRow & { employeeName: string })[] = [];

  for (const emp of employees) {
    const data = sheetData[emp.id];
    if (!data) continue;

    const name = `${emp.firstName} ${emp.lastName}`;
    const shopNames = [...new Set(data.orders.map((o) => o.shopName))];
    const totalSales = data.orders.reduce((sum, o) => sum + o.price, 0);
    const totalCost = data.orders.reduce((sum, o) => sum + o.cost, 0);
    const profit = data.orders.reduce((sum, o) => sum + o.profit, 0);
    const afterTax = data.orders.reduce((sum, o) => sum + o.afterTax, 0);
    const orderCount = data.orders.length;

    employeeAnalytics.push({
      userId: emp.id,
      name,
      employeeId: emp.employeeId,
      shopNames,
      totalSales: data.summary.totalSale || totalSales,
      totalCost: data.summary.totalCost || totalCost,
      profit: data.summary.grossProfit || profit,
      afterTax: data.summary.afterTax || afterTax,
      orders: orderCount,
      avgOrderValue: orderCount > 0 ? (data.summary.totalSale || totalSales) / orderCount : 0,
      error: data.error,
    });

    for (const order of data.orders) {
      allOrders.push({ ...order, employeeName: name });
    }
  }

  // Sort employees by profit (highest first)
  employeeAnalytics.sort((a, b) => b.profit - a.profit);

  // Overview totals
  const overview = {
    totalSales: employeeAnalytics.reduce((s, e) => s + e.totalSales, 0),
    totalCost: employeeAnalytics.reduce((s, e) => s + e.totalCost, 0),
    grossProfit: employeeAnalytics.reduce((s, e) => s + e.profit, 0),
    afterTax: employeeAnalytics.reduce((s, e) => s + e.afterTax, 0),
    totalOrders: employeeAnalytics.reduce((s, e) => s + e.orders, 0),
    avgOrderValue: 0,
  };
  overview.avgOrderValue = overview.totalOrders > 0 ? overview.totalSales / overview.totalOrders : 0;

  // Shop analytics
  const shopMap = new Map<string, ShopAnalytics>();
  for (const order of allOrders) {
    const key = order.shopName;
    const existing = shopMap.get(key) || { shopName: key, orders: 0, totalSales: 0, totalCost: 0, profit: 0 };
    existing.orders++;
    existing.totalSales += order.price;
    existing.totalCost += order.cost;
    existing.profit += order.profit;
    shopMap.set(key, existing);
  }
  const shops = [...shopMap.values()].sort((a, b) => b.profit - a.profit);

  // Daily sales
  const dailyMap = new Map<string, DailySales>();
  for (const order of allOrders) {
    // Parse date — try various formats
    const dateStr = normalizeDate(order.orderDate, month, year);
    if (!dateStr) continue;

    const existing = dailyMap.get(dateStr) || { date: dateStr, sales: 0, orders: 0 };
    existing.sales += order.price;
    existing.orders++;
    dailyMap.set(dateStr, existing);
  }
  const dailySales = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

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
