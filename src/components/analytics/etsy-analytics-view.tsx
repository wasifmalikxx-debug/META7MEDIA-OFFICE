"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  ShoppingCart,
  Users,
  Store,
  Calendar,
  Award,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Trophy,
  Star,
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
  const [showValues, setShowValues] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/etsy-analytics?month=${month}&year=${year}${force ? "&bust=" + Date.now() : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      setLastFetched(new Date());
    } catch (err: any) {
      setError(err.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every hour
  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Year options: current year and 2 prior
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 2, currentYear - 1, currentYear];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="size-5 text-muted-foreground" />
          <Select value={String(month)} onValueChange={(v: string | null) => v && setMonth(parseInt(v))}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v: string | null) => v && setYear(parseInt(v))}>
            <SelectTrigger className="w-[90px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[10px] text-muted-foreground/60">
              Updated {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowValues(!showValues)} className="gap-1.5 rounded-lg h-9">
            {showValues ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {showValues ? "Hide Values" : "Show Values"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={loading} className="gap-1.5 rounded-lg h-9">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading..." : "Refresh Data"}
          </Button>
        </div>
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
          {/* Section 1: Key Metrics (merged Overview + Quick Stats) */}
          <KeyMetrics overview={data.overview} quickStats={data.quickStats} show={showValues} />

          {/* Section 2: Employee Performance Table */}
          <EmployeeTable employees={data.employees} show={showValues} />

          {/* Section 3: Daily Sales Chart */}
          <DailySalesChart dailySales={data.dailySales} month={month} year={year} show={showValues} />

          {/* Section 4: Shop Performance Table */}
          <ShopPerformance shops={data.shops} show={showValues} />

          {/* Section 5: Highlights */}
          {data.quickStats && <Highlights stats={data.quickStats} show={showValues} />}
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

// ─── Section 1: Key Metrics (Merged Overview + Quick Stats) ───────

function MetricCard({
  label,
  value,
  subtitle,
  accentColor,
  show,
  noMask,
}: {
  label: string;
  value: string;
  subtitle?: string;
  accentColor?: "green" | "red" | "default";
  show: boolean;
  noMask?: boolean;
}) {
  const accent = accentColor === "green"
    ? "bg-emerald-600"
    : accentColor === "red"
    ? "bg-red-500"
    : "bg-slate-400 dark:bg-slate-500";

  const gradients: Record<string, string> = {
    green: "from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800",
    red: "from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800",
    default: "from-slate-50 to-white dark:from-slate-800 dark:to-slate-800",
  };

  return (
    <Card className={`border-0 shadow-sm overflow-hidden bg-gradient-to-br ${gradients[accentColor || "default"]}`}>
      <CardContent className="py-3.5 px-4">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {show || noMask ? value : "****"}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function KeyMetrics({
  overview,
  quickStats,
  show,
}: {
  overview: AnalyticsData["overview"];
  quickStats: QuickStatsData | null;
  show: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Row 1: Primary Metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Total Sales"
          value={usd(overview.totalSales)}
          show={show}
        />
        <MetricCard
          label="Total Cost"
          value={usd(overview.totalCost)}
          accentColor="red"
          show={show}
        />
        <MetricCard
          label="After Tax Profit"
          value={usd(overview.afterTax)}
          accentColor="green"
          show={show}
        />
        <MetricCard
          label="Total Orders"
          value={overview.totalOrders.toLocaleString()}
          show={show}
          subtitle="this month"
        />
      </div>

      {/* Row 2: Time-Based Metrics */}
      {quickStats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            label="Today's Sales"
            value={usd(quickStats.todaySales)}
            subtitle={show ? `${quickStats.todayOrders} order${quickStats.todayOrders !== 1 ? "s" : ""}` : ""}
            show={show}
          />
          <MetricCard
            label="Yesterday's Sales"
            value={usd(quickStats.yesterdaySales)}
            subtitle={show ? `${quickStats.yesterdayOrders} order${quickStats.yesterdayOrders !== 1 ? "s" : ""}` : ""}
            show={show}
          />
          <MetricCard
            label="This Week's Sales"
            value={usd(quickStats.weekSales)}
            subtitle={show ? `${quickStats.weekOrders} order${quickStats.weekOrders !== 1 ? "s" : ""}` : ""}
            show={show}
          />
          <MetricCard
            label="Avg Order Value"
            value={usd(overview.avgOrderValue)}
            show={show}
          />
        </div>
      )}
    </div>
  );
}

// ─── Section 2: Employee Performance Table ──────────────────────────

function ProfitIndicator({ profit }: { profit: number }) {
  if (profit > 1000) {
    return <span className="inline-block size-2 rounded-full bg-emerald-500 mr-1.5" />;
  }
  if (profit < 0) {
    return <span className="inline-block size-2 rounded-full bg-red-500 mr-1.5" />;
  }
  return null;
}

function EmployeeTable({ employees, show }: { employees: EmployeeData[]; show: boolean }) {
  const m = (v: string) => (show ? v : "****");
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
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardHeader className="pb-2 bg-emerald-50/40 dark:bg-emerald-950/10 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Users className="size-4 text-emerald-600" />
            Employee Performance
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">{employees.length} employees</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-xs">#</TableHead>
              <TableHead className="text-xs">Employee</TableHead>
              <TableHead className="text-center text-xs">Shops</TableHead>
              <TableHead className="text-center text-xs">Orders</TableHead>
              <TableHead className="text-right text-xs">Sales</TableHead>
              <TableHead className="text-right text-xs">Cost</TableHead>
              <TableHead className="text-right text-xs">Profit</TableHead>
              <TableHead className="text-right text-xs">After Tax</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">
                  No employee data available
                </TableCell>
              </TableRow>
            ) : (
              employees.map((emp, idx) => (
                <TableRow
                  key={emp.userId}
                  className={idx % 2 === 0 ? "bg-muted/30" : ""}
                >
                  <TableCell className="text-sm text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium text-foreground">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.employeeId}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-sm text-foreground">{show ? emp.shopNames.length : "**"}</TableCell>
                  <TableCell className="text-center text-sm text-foreground">{show ? emp.orders : "**"}</TableCell>
                  <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(emp.totalSales))}</TableCell>
                  <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(emp.totalCost))}</TableCell>
                  <TableCell className="text-right text-sm font-mono font-semibold text-foreground">
                    <span className="inline-flex items-center">
                      <ProfitIndicator profit={emp.profit} />
                      {m(usd(emp.profit))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(emp.afterTax))}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {employees.length > 0 && (
            <TableFooter>
              <TableRow className="font-bold bg-muted/50">
                <TableCell className="text-sm" />
                <TableCell className="text-sm text-foreground">TOTAL</TableCell>
                <TableCell className="text-center text-sm text-foreground">{show ? totals.shops : "**"}</TableCell>
                <TableCell className="text-center text-sm text-foreground">{show ? totals.orders : "**"}</TableCell>
                <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(totals.totalSales))}</TableCell>
                <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(totals.totalCost))}</TableCell>
                <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(totals.profit))}</TableCell>
                <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(totals.afterTax))}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Section 3: Daily Sales Chart (CSS-based) ───────────────────────

function DailySalesChart({
  dailySales,
  show,
  month,
  year,
}: {
  dailySales: DailySalesData[];
  month: number;
  year: number;
  show: boolean;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (dailySales.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="size-4" />
            Daily Sales
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
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
      <CardHeader className="pb-3 border-b">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Calendar className="size-4 text-slate-600" />
          Daily Sales — {MONTHS[month - 1]} {year}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Y-axis labels */}
          <div className="flex">
            <div
              className="flex w-12 shrink-0 flex-col justify-between text-right text-[10px] text-muted-foreground pr-2"
              style={{ height: "200px" }}
            >
              <span>{show ? shortUsd(maxSales) : "****"}</span>
              <span>{show ? shortUsd(maxSales * 0.75) : ""}</span>
              <span>{show ? shortUsd(maxSales * 0.5) : ""}</span>
              <span>{show ? shortUsd(maxSales * 0.25) : ""}</span>
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
                        <p className="font-semibold text-foreground">
                          {MONTHS[month - 1]} {dayNum}
                        </p>
                        <p className="text-foreground">{show ? usd(day.sales) : "****"}</p>
                        <p className="text-muted-foreground">
                          {day.orders} order{day.orders !== 1 ? "s" : ""}
                        </p>
                      </div>
                    )}

                    {/* Bar */}
                    <div
                      className={`w-full rounded-t-sm transition-colors ${
                        day.sales > 0
                          ? hoveredIndex === idx
                            ? "bg-slate-500 dark:bg-slate-400"
                            : "bg-slate-400/70 dark:bg-slate-500/70"
                          : "bg-muted/30"
                      }`}
                      style={{
                        height: `${Math.max(height, day.sales > 0 ? 2 : 0.5)}%`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* X-axis labels */}
          <div className="ml-12 mt-1 flex">
            {fullDays.map((day) => {
              const dayNum = parseInt(day.date.split("-")[2]);
              const showLabel = dayNum === 1 || dayNum % 5 === 0 || dayNum === daysInMonth;
              return (
                <div key={day.date} className="flex-1 text-center text-[9px] text-muted-foreground">
                  {showLabel ? dayNum : ""}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section 4: Shop Performance ─────────────────────────────────────

function ShopPerformance({ shops, show }: { shops: ShopData[]; show: boolean }) {
  const m = (v: string) => (show ? v : "****");
  const sorted = [...shops].sort((a, b) => b.profit - a.profit);

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardHeader className="pb-2 bg-blue-50/40 dark:bg-blue-950/10 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Store className="size-4 text-blue-600" />
            Shop Performance
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">{sorted.length} shops</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-xs">#</TableHead>
              <TableHead className="text-xs">Shop</TableHead>
              <TableHead className="text-center text-xs">Orders</TableHead>
              <TableHead className="text-right text-xs">Sales</TableHead>
              <TableHead className="text-right text-xs">Cost</TableHead>
              <TableHead className="text-right text-xs">Profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">
                  No shop data available
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((shop, idx) => (
                <TableRow key={shop.shopName} className={idx % 2 === 0 ? "bg-muted/30" : ""}>
                  <TableCell className="text-sm text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="text-sm font-medium text-foreground">{shop.shopName}</TableCell>
                  <TableCell className="text-center text-sm text-foreground">{show ? shop.orders : "**"}</TableCell>
                  <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(shop.totalSales))}</TableCell>
                  <TableCell className="text-right text-sm font-mono text-foreground">{m(usd(shop.totalCost))}</TableCell>
                  <TableCell className="text-right text-sm font-mono font-semibold text-foreground">
                    <span className="inline-flex items-center">
                      <ProfitIndicator profit={shop.profit} />
                      {m(usd(shop.profit))}
                    </span>
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

// ─── Section 5: Highlights ───────────────────────────────────────────

function Highlights({ stats, show }: { stats: QuickStatsData; show: boolean }) {
  const m = (v: string) => (show ? v : "****");

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
        <CardContent className="py-4 px-4">
          <div className="flex items-center gap-2.5">
            <div className="size-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Trophy className="size-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Top Performer</p>
              <p className="text-sm font-bold">{stats.bestEmployee || "N/A"}</p>
              <p className="text-[10px] text-muted-foreground">Profit: {m(usd(stats.bestEmployeeProfit))}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
        <CardContent className="py-4 px-4">
          <div className="flex items-center gap-2.5">
            <div className="size-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Award className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Best Shop</p>
              <p className="text-sm font-bold">{stats.bestShop || "N/A"}</p>
              <p className="text-[10px] text-muted-foreground">Profit: {m(usd(stats.bestShopProfit))}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-800">
        <CardContent className="py-4 px-4">
          <div className="flex items-center gap-2.5">
            <div className="size-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <Star className="size-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Highest Order</p>
              <p className="text-sm font-bold">{m(usd(stats.highestOrder))}</p>
              <p className="text-[10px] text-muted-foreground">{stats.highestOrderShop || "N/A"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
