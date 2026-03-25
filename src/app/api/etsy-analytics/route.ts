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
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));

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

  // Quick stats
  const today = new Date();
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  // Week: last 7 days
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);

  const todayData = dailyMap.get(todayStr);
  const yesterdayData = dailyMap.get(yesterdayStr);

  let weekOrders = 0;
  let weekSales = 0;
  for (const [dateStr, data] of dailyMap) {
    const d = new Date(dateStr);
    if (d >= weekStart && d <= today) {
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

function normalizeDate(dateStr: string, expectedMonth: number, expectedYear: number): string | null {
  if (!dateStr) return null;

  // Try parsing various formats
  const cleaned = dateStr.trim();

  // Try direct Date parse
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    const m = parsed.getMonth() + 1;
    const y = parsed.getFullYear();
    // Only accept dates in the expected month
    if (m === expectedMonth && (y === expectedYear || y === 0)) {
      return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
    // If year is way off (like 1900s from Excel serial dates), still use it if month matches
    if (m === expectedMonth) {
      return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
  }

  // Try MM/DD/YYYY or M/D/YYYY
  const slashMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1]);
    const p2 = parseInt(slashMatch[2]);
    const p3 = parseInt(slashMatch[3]);
    const fullYear = p3 < 100 ? 2000 + p3 : p3;

    // Try MM/DD/YYYY
    if (p1 === expectedMonth && fullYear === expectedYear) {
      return `${expectedYear}-${String(p1).padStart(2, "0")}-${String(p2).padStart(2, "0")}`;
    }
    // Try DD/MM/YYYY
    if (p2 === expectedMonth && fullYear === expectedYear) {
      return `${expectedYear}-${String(p2).padStart(2, "0")}-${String(p1).padStart(2, "0")}`;
    }
  }

  return null;
}
