"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Users,
  Store,
  Calendar,
  Award,
  Loader2,
  AlertCircle,
  BarChart3,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────

interface EmployeeData {
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

interface ShopData {
  shopName: string;
  orders: number;
  totalSales: number;
  totalCost: number;
  profit: number;
}

interface DailySalesData {
  date: string;
  sales: number;
  orders: number;
}

interface QuickStatsData {
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

interface AnalyticsData {
  month: number;
  year: number;
  overview: {
    totalSales: number;
    totalCost: number;
    grossProfit: number;
    afterTax: number;
    totalOrders: number;
    avgOrderValue: number;
  };
  employees: EmployeeData[];
  shops: ShopData[];
  dailySales: DailySalesData[];
  quickStats: QuickStatsData | null;
}

// ─── Helpers ───────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function usd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function shortUsd(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }
  return usd(amount);
}

// ─── Component ─────────────────────────────────────────────────────

interface EtsyAnalyticsViewProps {
  initialMonth: number;
  initialYear: number;
}

export function EtsyAnalyticsView({ initialMonth, initialYear }: EtsyAnalyticsViewProps) {
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/etsy-analytics?month=${month}&year=${year}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Year options: current year and 2 prior
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 2, currentYear - 1, currentYear];

  return (
    <div className="space-y-6">
      {/* Month / Year Selector */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading...
          </div>
        )}
      </div>

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="size-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {data && !loading && (
        <>
          {/* Section 1: Overview Cards */}
          <OverviewCards overview={data.overview} />

          {/* Section 2: Employee Performance Table */}
          <EmployeeTable employees={data.employees} />

          {/* Section 3: Daily Sales Chart */}
          <DailySalesChart dailySales={data.dailySales} month={month} year={year} />

          {/* Section 4: Shop Performance */}
          <ShopPerformance shops={data.shops} />

          {/* Section 5: Quick Stats */}
          {data.quickStats && <QuickStats stats={data.quickStats} />}
        </>
      )}

      {!data && !loading && !error && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No data available for the selected period.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Section 1: Overview Cards ─────────────────────────────────────

function OverviewCards({ overview }: { overview: AnalyticsData["overview"] }) {
  const cards = [
    { title: "Total Sales", value: usd(overview.totalSales), icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { title: "Total Cost", value: usd(overview.totalCost), icon: TrendingDown, color: "text-red-500", bg: "bg-red-500/10" },
    { title: "Gross Profit", value: usd(overview.grossProfit), icon: TrendingUp, color: "text-blue-500", bg: "bg-blue-500/10" },
    { title: "After Tax Profit", value: usd(overview.afterTax), icon: DollarSign, color: "text-purple-500", bg: "bg-purple-500/10" },
    { title: "Total Orders", value: overview.totalOrders.toLocaleString(), icon: ShoppingCart, color: "text-orange-500", bg: "bg-orange-500/10" },
    { title: "Avg Order Value", value: usd(overview.avgOrderValue), icon: BarChart3, color: "text-teal-500", bg: "bg-teal-500/10" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">{card.title}</p>
              <div className={`rounded-md p-1.5 ${card.bg}`}>
                <card.icon className={`size-3.5 ${card.color}`} />
              </div>
            </div>
            <p className={`mt-2 text-lg font-bold ${card.color}`}>{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Section 2: Employee Performance Table ─────────────────────────

function EmployeeTable({ employees }: { employees: EmployeeData[] }) {
  const totals = employees.reduce(
    (acc, e) => ({
      totalSales: acc.totalSales + e.totalSales,
      totalCost: acc.totalCost + e.totalCost,
      profit: acc.profit + e.profit,
      afterTax: acc.afterTax + e.afterTax,
      orders: acc.orders + e.orders,
      shops: acc.shops + e.shopNames.length,
    }),
    { totalSales: 0, totalCost: 0, profit: 0, afterTax: 0, orders: 0, shops: 0 }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5" />
          Employee Performance
        </CardTitle>
        <CardDescription>Individual employee metrics for the selected month</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-center">Shops</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">After Tax</TableHead>
              <TableHead className="text-center">Orders</TableHead>
              <TableHead className="text-right">Avg Order</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No employee data available
                </TableCell>
              </TableRow>
            ) : (
              employees.map((emp) => (
                <TableRow
                  key={emp.userId}
                  className={emp.profit > 1000 ? "bg-emerald-500/5" : emp.profit < 0 ? "bg-red-500/5" : ""}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.employeeId}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{emp.shopNames.length}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">{usd(emp.totalSales)}</TableCell>
                  <TableCell className="text-right font-mono text-red-600 dark:text-red-400">{usd(emp.totalCost)}</TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${emp.profit >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}`}>
                    {usd(emp.profit)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-purple-600 dark:text-purple-400">{usd(emp.afterTax)}</TableCell>
                  <TableCell className="text-center">{emp.orders}</TableCell>
                  <TableCell className="text-right font-mono">{usd(emp.avgOrderValue)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {employees.length > 0 && (
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell>TOTAL</TableCell>
                <TableCell className="text-center">{totals.shops}</TableCell>
                <TableCell className="text-right font-mono">{usd(totals.totalSales)}</TableCell>
                <TableCell className="text-right font-mono">{usd(totals.totalCost)}</TableCell>
                <TableCell className="text-right font-mono">{usd(totals.profit)}</TableCell>
                <TableCell className="text-right font-mono">{usd(totals.afterTax)}</TableCell>
                <TableCell className="text-center">{totals.orders}</TableCell>
                <TableCell className="text-right font-mono">
                  {totals.orders > 0 ? usd(totals.totalSales / totals.orders) : "$0.00"}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Section 3: Daily Sales Chart (CSS-based) ─────────────────────

function DailySalesChart({
  dailySales,
  month,
  year,
}: {
  dailySales: DailySalesData[];
  month: number;
  year: number;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (dailySales.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-5" />
            Daily Sales
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          No daily sales data available for this month.
        </CardContent>
      </Card>
    );
  }

  // Fill in all days of the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const fullDays: DailySalesData[] = [];
  const salesMap = new Map(dailySales.map((d) => [d.date, d]));

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const existing = salesMap.get(dateStr);
    fullDays.push(existing || { date: dateStr, sales: 0, orders: 0 });
  }

  const maxSales = Math.max(...fullDays.map((d) => d.sales), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="size-5" />
          Daily Sales — {MONTHS[month - 1]} {year}
        </CardTitle>
        <CardDescription>Sales per day across all employees</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Y-axis labels */}
          <div className="flex">
            <div className="flex w-12 shrink-0 flex-col justify-between text-right text-[10px] text-muted-foreground pr-2" style={{ height: "200px" }}>
              <span>{shortUsd(maxSales)}</span>
              <span>{shortUsd(maxSales * 0.75)}</span>
              <span>{shortUsd(maxSales * 0.5)}</span>
              <span>{shortUsd(maxSales * 0.25)}</span>
              <span>$0</span>
            </div>

            {/* Chart bars */}
            <div className="flex flex-1 items-end gap-[1px]" style={{ height: "200px" }}>
              {fullDays.map((day, idx) => {
                const height = maxSales > 0 ? (day.sales / maxSales) * 100 : 0;
                const dayNum = parseInt(day.date.split("-")[2]);

                return (
                  <div
                    key={day.date}
                    className="group relative flex flex-1 flex-col items-center justify-end"
                    style={{ height: "100%" }}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Tooltip */}
                    {hoveredIndex === idx && day.sales > 0 && (
                      <div className="absolute -top-16 z-50 whitespace-nowrap rounded-md bg-popover px-3 py-1.5 text-xs shadow-lg ring-1 ring-foreground/10">
                        <p className="font-semibold">{MONTHS[month - 1]} {dayNum}</p>
                        <p className="text-emerald-500">{usd(day.sales)}</p>
                        <p className="text-muted-foreground">{day.orders} order{day.orders !== 1 ? "s" : ""}</p>
                      </div>
                    )}

                    {/* Bar */}
                    <div
                      className={`w-full rounded-t-sm transition-colors ${
                        day.sales > 0
                          ? hoveredIndex === idx
                            ? "bg-emerald-400 dark:bg-emerald-500"
                            : "bg-emerald-500/70 dark:bg-emerald-600/70"
                          : "bg-muted/30"
                      }`}
                      style={{ height: `${Math.max(height, day.sales > 0 ? 2 : 0.5)}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* X-axis labels */}
          <div className="ml-12 mt-1 flex">
            {fullDays.map((day, idx) => {
              const dayNum = parseInt(day.date.split("-")[2]);
              // Only show every 5th day + first and last
              const show = dayNum === 1 || dayNum % 5 === 0 || dayNum === daysInMonth;
              return (
                <div key={day.date} className="flex-1 text-center text-[9px] text-muted-foreground">
                  {show ? dayNum : ""}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section 4: Shop Performance ───────────────────────────────────

function ShopPerformance({ shops }: { shops: ShopData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="size-5" />
          Shop Performance
        </CardTitle>
        <CardDescription>Aggregated metrics per shop across all employees</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Shop Name</TableHead>
              <TableHead className="text-center">Orders</TableHead>
              <TableHead className="text-right">Total Sales</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
              <TableHead className="text-right">Profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shops.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No shop data available
                </TableCell>
              </TableRow>
            ) : (
              shops.map((shop, idx) => (
                <TableRow key={shop.shopName}>
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="font-medium">{shop.shopName}</TableCell>
                  <TableCell className="text-center">{shop.orders}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">{usd(shop.totalSales)}</TableCell>
                  <TableCell className="text-right font-mono text-red-600 dark:text-red-400">{usd(shop.totalCost)}</TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${shop.profit >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}`}>
                    {usd(shop.profit)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Section 5: Quick Stats ────────────────────────────────────────

function QuickStats({ stats }: { stats: QuickStatsData }) {
  const items = [
    {
      label: "Today",
      value: `${stats.todayOrders} orders`,
      sub: usd(stats.todaySales),
      icon: Calendar,
      color: "text-blue-500",
    },
    {
      label: "Yesterday",
      value: `${stats.yesterdayOrders} orders`,
      sub: usd(stats.yesterdaySales),
      icon: Calendar,
      color: "text-slate-500",
    },
    {
      label: "This Week",
      value: `${stats.weekOrders} orders`,
      sub: usd(stats.weekSales),
      icon: TrendingUp,
      color: "text-emerald-500",
    },
    {
      label: "Best Employee",
      value: stats.bestEmployee,
      sub: `Profit: ${usd(stats.bestEmployeeProfit)}`,
      icon: Award,
      color: "text-amber-500",
    },
    {
      label: "Best Shop",
      value: stats.bestShop,
      sub: `Profit: ${usd(stats.bestShopProfit)}`,
      icon: Store,
      color: "text-purple-500",
    },
    {
      label: "Highest Order",
      value: usd(stats.highestOrder),
      sub: stats.highestOrderShop ? `${stats.highestOrderShop}` : "N/A",
      icon: DollarSign,
      color: "text-rose-500",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="size-5" />
          Quick Stats
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {items.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border bg-muted/30 p-3 space-y-1"
            >
              <div className="flex items-center gap-1.5">
                <item.icon className={`size-3.5 ${item.color}`} />
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  {item.label}
                </p>
              </div>
              <p className="text-sm font-semibold truncate">{item.value}</p>
              <p className="text-xs text-muted-foreground truncate">{item.sub}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
