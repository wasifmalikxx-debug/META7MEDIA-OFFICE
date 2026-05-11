"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar,
  RefreshCw,
  Eye,
  EyeOff,
  Trophy,
  Crown,
  Tag,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Wallet,
  Store,
  Users,
  Activity,
  Sparkles,
  Receipt,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

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

/** Full USD formatter — used inside totals/tooltips where precision matters. */
function usd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Compact $ — for big hero numbers that don't need cents. */
function compactUsd(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${amount < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${amount < 0 ? "-" : ""}$${Math.round(abs / 1_000)}k`;
  if (abs >= 1_000) return `${amount < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}k`;
  return usd(amount);
}

/** Mask sensitive numbers when the show-values toggle is off. Bullets read
 *  more refined than the original "****" — same length-ish, less alarming. */
const MASK = "•••••";
function maskedUsd(amount: number, show: boolean): string {
  return show ? usd(amount) : MASK;
}
function maskedCompact(amount: number, show: boolean): string {
  return show ? compactUsd(amount) : MASK;
}
function maskedNum(n: number, show: boolean): string {
  return show ? n.toLocaleString() : "••";
}

// ─── Component ─────────────────────────────────────────────────────

interface EtsyAnalyticsViewProps {
  initialMonth: number;
  initialYear: number;
  teamKey: "em" | "ae" | "me";
}

export function EtsyAnalyticsView({
  initialMonth,
  initialYear,
  teamKey,
}: EtsyAnalyticsViewProps) {
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchData = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/etsy-analytics?month=${month}&year=${year}&team=${teamKey}${
          force ? "&bust=" + Date.now() : ""
        }`;
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
    },
    [month, year, teamKey],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh hourly — sheets data changes throughout the day as employees
  // log new orders. 60 min is a reasonable middle ground (the server itself
  // caches for 5 min so this is mostly a no-op on a stable view).
  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 2, currentYear - 1, currentYear];

  // Pre-compute the day-over-day delta for the Today pulse tile. Showing
  // "↑ +42% vs yesterday" is more useful than just the raw $1,200.
  const todayDelta = useMemo(() => {
    if (!data?.quickStats) return null;
    const { todaySales, yesterdaySales } = data.quickStats;
    if (yesterdaySales <= 0) return null;
    const change = ((todaySales - yesterdaySales) / yesterdaySales) * 100;
    return Math.round(change);
  }, [data?.quickStats]);

  return (
    <div className="space-y-5">
      {/* ═══════════════════════ CONTROL BAR ═══════════════════════ */}
      <ControlsBar
        month={month}
        year={year}
        yearOptions={yearOptions}
        onMonthChange={setMonth}
        onYearChange={setYear}
        showValues={showValues}
        onToggleValues={() => setShowValues((s) => !s)}
        loading={loading}
        lastFetched={lastFetched}
        onRefresh={() => fetchData(true)}
      />

      {/* Error banner — surfaced inline so the controls remain usable. */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5 shadow-none">
          <CardContent className="flex items-start gap-3 py-3 px-4">
            <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Couldn&apos;t load analytics</p>
              <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cold-load skeleton — reading 7–14 Google Sheets takes 30–60s the
          first time per scope. A live skeleton beats a spinner because the
          page shape doesn't shift when data arrives. */}
      {!data && loading && !error && <LoadingSkeleton />}

      {data && (
        <>
          {/* ═══════════════════════ KPI STRIP ═══════════════════════ */}
          <KpiStrip overview={data.overview} show={showValues} />

          {/* ═══════════════ PERFORMANCE (PULSE + CHART) ═══════════════ */}
          <PerformanceCard
            quickStats={data.quickStats}
            dailySales={data.dailySales}
            month={month}
            year={year}
            show={showValues}
            todayDelta={todayDelta}
          />

          {/* ═══════════════════════ HIGHLIGHTS ═══════════════════════ */}
          {data.quickStats && (
            <Highlights stats={data.quickStats} show={showValues} />
          )}

          {/* ════════════════════ EMPLOYEE LEADERBOARD ════════════════════ */}
          <EmployeeLeaderboard employees={data.employees} show={showValues} />

          {/* ════════════════════ SHOP LEADERBOARD ════════════════════ */}
          <ShopLeaderboard shops={data.shops} show={showValues} />
        </>
      )}

      {!data && !loading && !error && (
        <Card className="border shadow-none">
          <CardContent className="py-16 text-center">
            <Calendar className="size-7 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">No data for this period</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try a different month or refresh the data.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────── ControlsBar ───────────────────────────

/**
 * Top control strip — month/year selectors, last-updated indicator, and
 * the show-values + refresh buttons. Compact so it doesn't compete with
 * the page header above it.
 */
function ControlsBar({
  month,
  year,
  yearOptions,
  onMonthChange,
  onYearChange,
  showValues,
  onToggleValues,
  loading,
  lastFetched,
  onRefresh,
}: {
  month: number;
  year: number;
  yearOptions: number[];
  onMonthChange: (v: number) => void;
  onYearChange: (v: number) => void;
  showValues: boolean;
  onToggleValues: () => void;
  loading: boolean;
  lastFetched: Date | null;
  onRefresh: () => void;
}) {
  return (
    <Card className="border shadow-none">
      <CardContent className="py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            <Select
              value={String(month)}
              onValueChange={(v: string | null) => v && onMonthChange(parseInt(v))}
            >
              <SelectTrigger className="w-[125px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(year)}
              onValueChange={(v: string | null) => v && onYearChange(parseInt(v))}
            >
              <SelectTrigger className="w-[80px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            {lastFetched && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] text-muted-foreground mr-1">
                <span className="size-1 rounded-full bg-emerald-500" />
                Updated {lastFetched.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleValues}
              className="gap-1.5 h-8 text-xs"
            >
              {showValues ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              <span className="hidden sm:inline">{showValues ? "Hide values" : "Show values"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className="gap-1.5 h-8 text-xs"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{loading ? "Loading…" : "Refresh"}</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── KpiStrip ───────────────────────────

/**
 * Five hero metrics for the selected month. Each tile has a single tone
 * and a tight subtitle so the strip reads as a coherent row instead of
 * a wall of colored cards.
 */
function KpiStrip({
  overview,
  show,
}: {
  overview: AnalyticsData["overview"];
  show: boolean;
}) {
  return (
    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <KpiTile
        label="Total sales"
        value={maskedCompact(overview.totalSales, show)}
        icon={ShoppingCart}
        tone="slate"
        subtitle={show ? usd(overview.totalSales) : MASK}
      />
      <KpiTile
        label="Total cost"
        value={maskedCompact(overview.totalCost, show)}
        icon={Wallet}
        tone="rose"
        subtitle={show ? usd(overview.totalCost) : MASK}
      />
      <KpiTile
        label="Gross profit"
        value={maskedCompact(overview.grossProfit, show)}
        icon={TrendingUp}
        tone="emerald"
        subtitle={show ? usd(overview.grossProfit) : MASK}
        accent="primary"
      />
      <KpiTile
        label="Orders"
        value={maskedNum(overview.totalOrders, show)}
        icon={Receipt}
        tone="amber"
        subtitle="this month"
      />
      <KpiTile
        label="Avg order"
        value={maskedUsd(overview.avgOrderValue, show)}
        icon={Tag}
        tone="violet"
        subtitle="per transaction"
      />
    </section>
  );
}

/**
 * Single KPI tile.
 *
 * `accent="primary"` adds a subtle ring + bold treatment so the Gross
 * Profit tile reads as the headline number among its peers.
 */
function KpiTile({
  label,
  value,
  subtitle,
  icon: Icon,
  tone,
  accent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: any;
  tone: "slate" | "emerald" | "rose" | "amber" | "violet";
  accent?: "primary";
}) {
  const tones = {
    slate: { iconBg: "bg-slate-100 dark:bg-slate-800/60", iconText: "text-slate-700 dark:text-slate-300" },
    emerald: { iconBg: "bg-emerald-50 dark:bg-emerald-950/40", iconText: "text-emerald-600 dark:text-emerald-400" },
    rose: { iconBg: "bg-rose-50 dark:bg-rose-950/40", iconText: "text-rose-600 dark:text-rose-400" },
    amber: { iconBg: "bg-amber-50 dark:bg-amber-950/40", iconText: "text-amber-600 dark:text-amber-400" },
    violet: { iconBg: "bg-violet-50 dark:bg-violet-950/40", iconText: "text-violet-600 dark:text-violet-400" },
  } as const;
  const t = tones[tone];
  const isPrimary = accent === "primary";

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-card p-4 transition-colors ${
        isPrimary ? "ring-1 ring-emerald-500/20 dark:ring-emerald-400/20" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`size-8 rounded-lg flex items-center justify-center ${t.iconBg}`}>
          <Icon className={`size-3.5 ${t.iconText}`} />
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.12em] mb-1.5">
          {label}
        </p>
        <div className="flex items-baseline gap-1.5 mb-1">
          <span
            className={`text-[26px] font-bold tabular-nums tracking-tight leading-none ${
              isPrimary ? "text-emerald-700 dark:text-emerald-400" : ""
            }`}
          >
            {value}
          </span>
        </div>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground mt-1 tabular-nums truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── PerformanceCard ───────────────────────────

/**
 * Combined card with the temporal pulse (Today / Yesterday / Week) above
 * a full-width daily-sales area chart. Putting them in one container
 * communicates that they're answering the same question: "how is this
 * month performing day-to-day?"
 */
function PerformanceCard({
  quickStats,
  dailySales,
  month,
  year,
  show,
  todayDelta,
}: {
  quickStats: QuickStatsData | null;
  dailySales: DailySalesData[];
  month: number;
  year: number;
  show: boolean;
  todayDelta: number | null;
}) {
  return (
    <Card className="border shadow-none overflow-hidden">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Performance</CardTitle>
          </div>
          <Badge variant="outline" className="text-[10px] font-normal h-5">
            {MONTHS[month - 1]} {year}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {quickStats && (
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x border-b">
            <PulseTile
              label="Today"
              sales={quickStats.todaySales}
              orders={quickStats.todayOrders}
              delta={todayDelta}
              show={show}
            />
            <PulseTile
              label="Yesterday"
              sales={quickStats.yesterdaySales}
              orders={quickStats.yesterdayOrders}
              show={show}
            />
            <PulseTile
              label="This week"
              sales={quickStats.weekSales}
              orders={quickStats.weekOrders}
              show={show}
            />
          </div>
        )}
        <DailySalesChart
          dailySales={dailySales}
          month={month}
          year={year}
          show={show}
        />
      </CardContent>
    </Card>
  );
}

function PulseTile({
  label,
  sales,
  orders,
  delta,
  show,
}: {
  label: string;
  sales: number;
  orders: number;
  delta?: number | null;
  show: boolean;
}) {
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.12em]">
          {label}
        </p>
        {delta !== null && delta !== undefined && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${
              positive
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {positive ? (
              <TrendingUp className="size-3" />
            ) : (
              <TrendingDown className="size-3" />
            )}
            {positive ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
      <div className="text-[22px] font-bold tabular-nums tracking-tight leading-none">
        {maskedUsd(sales, show)}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
        {show ? `${orders.toLocaleString()} ${orders === 1 ? "order" : "orders"}` : MASK}
      </p>
    </div>
  );
}

// ─────────────────────────── DailySalesChart ───────────────────────────

/**
 * Recharts area chart for daily sales across the month. Fills in zeros
 * for missing days so the x-axis spans 1–31 consistently. Tooltip shows
 * the day, sales, and order count for that day.
 */
function DailySalesChart({
  dailySales,
  month,
  year,
  show,
}: {
  dailySales: DailySalesData[];
  month: number;
  year: number;
  show: boolean;
}) {
  // Backfill missing days as zero so the x-axis spans the full month.
  const fullDays = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const salesMap = new Map(dailySales.map((d) => [d.date, d]));
    const out: { day: number; sales: number; orders: number; label: string }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const existing = salesMap.get(dateStr);
      out.push({
        day: d,
        sales: existing?.sales ?? 0,
        orders: existing?.orders ?? 0,
        label: `${MONTHS[month - 1]} ${d}`,
      });
    }
    return out;
  }, [dailySales, month, year]);

  const hasAnySales = fullDays.some((d) => d.sales > 0);

  if (!hasAnySales) {
    return (
      <div className="py-12 text-center">
        <ShoppingCart className="size-7 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No sales recorded yet this month.</p>
      </div>
    );
  }

  return (
    <div className="px-3 py-4">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={fullDays} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="dailySalesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={50}
              tickFormatter={(v: number) => (show ? compactUsd(v).replace("$", "$") : "•")}
            />
            <Tooltip
              cursor={{ stroke: "hsl(var(--muted))", strokeDasharray: "3 3" }}
              contentStyle={{
                fontSize: 11,
                borderRadius: 8,
                border: "1px solid hsl(var(--border))",
                backgroundColor: "hsl(var(--background))",
                boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              }}
              labelFormatter={(_v: any, payload: any) => payload?.[0]?.payload?.label || ""}
              formatter={(value: any, _name: any, props: any) => {
                const orders = props?.payload?.orders ?? 0;
                return [
                  `${show ? usd(value as number) : MASK} · ${orders} ${orders === 1 ? "order" : "orders"}`,
                  "Sales",
                ];
              }}
            />
            <Area
              type="monotone"
              dataKey="sales"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#dailySalesGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────── Highlights ───────────────────────────

/**
 * Three "wins of the month" cards: Top Performer (employee), Best Shop,
 * and Highest Single Order. Restrained styling — colored icon chips
 * inside otherwise-neutral cards.
 */
function Highlights({
  stats,
  show,
}: {
  stats: QuickStatsData;
  show: boolean;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-3">
      <HighlightCard
        label="Top performer"
        primary={stats.bestEmployee || "—"}
        secondary={`Profit ${maskedUsd(stats.bestEmployeeProfit, show)}`}
        icon={Crown}
        tone="amber"
      />
      <HighlightCard
        label="Best shop"
        primary={stats.bestShop || "—"}
        secondary={`Profit ${maskedUsd(stats.bestShopProfit, show)}`}
        icon={Trophy}
        tone="emerald"
      />
      <HighlightCard
        label="Highest order"
        primary={maskedUsd(stats.highestOrder, show)}
        secondary={stats.highestOrderShop || "—"}
        icon={Sparkles}
        tone="violet"
      />
    </section>
  );
}

function HighlightCard({
  label,
  primary,
  secondary,
  icon: Icon,
  tone,
}: {
  label: string;
  primary: string;
  secondary: string;
  icon: any;
  tone: "amber" | "emerald" | "violet";
}) {
  const tones = {
    amber: { bg: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-600 dark:text-amber-400" },
    emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-600 dark:text-emerald-400" },
    violet: { bg: "bg-violet-50 dark:bg-violet-950/40", text: "text-violet-600 dark:text-violet-400" },
  } as const;
  const t = tones[tone];
  return (
    <Card className="border shadow-none">
      <CardContent className="py-3.5 px-4">
        <div className="flex items-center gap-3">
          <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${t.bg}`}>
            <Icon className={`size-4.5 ${t.text}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.12em]">
              {label}
            </p>
            <p className="text-sm font-bold truncate mt-0.5 leading-tight">{primary}</p>
            <p className="text-[11px] text-muted-foreground tabular-nums truncate mt-0.5">
              {secondary}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── EmployeeLeaderboard ───────────────────────────

/**
 * Refined employee performance leaderboard. Rank badge for podium spots,
 * avatar circle with initials, inline profit-share bar so the eye can
 * read who's contributing the most without doing math.
 */
function EmployeeLeaderboard({
  employees,
  show,
}: {
  employees: EmployeeData[];
  show: boolean;
}) {
  const totals = useMemo(() => {
    return employees.reduce(
      (acc, e) => ({
        totalSales: acc.totalSales + e.totalSales,
        totalCost: acc.totalCost + e.totalCost,
        profit: acc.profit + e.profit,
        orders: acc.orders + e.orders,
        shops: acc.shops + e.shopNames.length,
      }),
      { totalSales: 0, totalCost: 0, profit: 0, orders: 0, shops: 0 },
    );
  }, [employees]);

  // Sort by profit desc — leaderboard semantics. Negative-profit employees
  // float to the bottom.
  const ranked = useMemo(
    () => [...employees].sort((a, b) => b.profit - a.profit),
    [employees],
  );

  // Max absolute profit drives the share-bar width so the strongest
  // performer fills the bar and everyone else scales relative to them.
  const maxProfit = Math.max(1, ...ranked.map((e) => Math.abs(e.profit)));

  return (
    <Card className="border shadow-none overflow-hidden">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Employee performance</CardTitle>
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {employees.length} {employees.length === 1 ? "employee" : "employees"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {ranked.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="size-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No employee data for this period.</p>
          </div>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-[40px_minmax(160px,2fr)_72px_72px_120px_120px_minmax(180px,1.6fr)] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70 border-b bg-muted/15">
              <div>Rank</div>
              <div>Employee</div>
              <div className="text-center">Shops</div>
              <div className="text-center">Orders</div>
              <div className="text-right">Sales</div>
              <div className="text-right">Cost</div>
              <div className="text-right">Profit · share</div>
            </div>
            <ul className="divide-y">
              {ranked.map((emp, idx) => (
                <EmployeeRow
                  key={emp.userId}
                  emp={emp}
                  rank={idx + 1}
                  maxProfit={maxProfit}
                  show={show}
                />
              ))}
            </ul>
            <div className="grid grid-cols-[40px_minmax(160px,2fr)_72px_72px_120px_120px_minmax(180px,1.6fr)] gap-3 px-4 py-2.5 border-t bg-muted/20 text-xs font-semibold">
              <div />
              <div className="uppercase text-[10px] tracking-[0.12em] text-muted-foreground/80">Total</div>
              <div className="text-center tabular-nums">{maskedNum(totals.shops, show)}</div>
              <div className="text-center tabular-nums">{maskedNum(totals.orders, show)}</div>
              <div className="text-right tabular-nums">{maskedCompact(totals.totalSales, show)}</div>
              <div className="text-right tabular-nums">{maskedCompact(totals.totalCost, show)}</div>
              <div className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                {maskedCompact(totals.profit, show)}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EmployeeRow({
  emp,
  rank,
  maxProfit,
  show,
}: {
  emp: EmployeeData;
  rank: number;
  maxProfit: number;
  show: boolean;
}) {
  const initials =
    (emp.name?.split(" ").map((w) => w[0]).join("").slice(0, 2) || "??").toUpperCase();
  const profitPct = (Math.abs(emp.profit) / maxProfit) * 100;
  const isPositive = emp.profit >= 0;

  return (
    <li className="px-4 py-3 hover:bg-muted/20 transition-colors">
      {/* Desktop layout — full grid */}
      <div className="hidden md:grid grid-cols-[40px_minmax(160px,2fr)_72px_72px_120px_120px_minmax(180px,1.6fr)] gap-3 items-center">
        <RankBadge rank={rank} />
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-8 rounded-full bg-muted text-[11px] font-bold flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate leading-tight">{emp.name}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{emp.employeeId}</p>
          </div>
        </div>
        <div className="text-center text-sm tabular-nums">{maskedNum(emp.shopNames.length, show)}</div>
        <div className="text-center text-sm tabular-nums">{maskedNum(emp.orders, show)}</div>
        <div className="text-right text-sm tabular-nums">{maskedCompact(emp.totalSales, show)}</div>
        <div className="text-right text-sm tabular-nums">{maskedCompact(emp.totalCost, show)}</div>
        <div className="flex items-center gap-2 justify-end">
          <ShareBar percent={profitPct} positive={isPositive} />
          <span
            className={`text-sm font-semibold tabular-nums shrink-0 w-[80px] text-right ${
              isPositive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
            }`}
          >
            {maskedCompact(emp.profit, show)}
          </span>
        </div>
      </div>

      {/* Mobile layout — stacked */}
      <div className="md:hidden">
        <div className="flex items-center gap-3 mb-2">
          <RankBadge rank={rank} />
          <div className="size-8 rounded-full bg-muted text-[11px] font-bold flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate leading-tight">{emp.name}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{emp.employeeId}</p>
          </div>
          <span
            className={`text-sm font-bold tabular-nums shrink-0 ${
              isPositive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
            }`}
          >
            {maskedCompact(emp.profit, show)}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-11 text-[11px] text-muted-foreground tabular-nums">
          <span>{maskedNum(emp.orders, show)} orders</span>
          <span>· {maskedCompact(emp.totalSales, show)} sales</span>
          <span>· {maskedNum(emp.shopNames.length, show)} shops</span>
        </div>
        <div className="ml-11 mt-2">
          <ShareBar percent={profitPct} positive={isPositive} />
        </div>
      </div>
    </li>
  );
}

// ─────────────────────────── ShopLeaderboard ───────────────────────────

function ShopLeaderboard({
  shops,
  show,
}: {
  shops: ShopData[];
  show: boolean;
}) {
  const ranked = useMemo(
    () => [...shops].sort((a, b) => b.profit - a.profit),
    [shops],
  );
  const maxProfit = Math.max(1, ...ranked.map((s) => Math.abs(s.profit)));
  const totals = useMemo(
    () =>
      shops.reduce(
        (acc, s) => ({
          totalSales: acc.totalSales + s.totalSales,
          totalCost: acc.totalCost + s.totalCost,
          profit: acc.profit + s.profit,
          orders: acc.orders + s.orders,
        }),
        { totalSales: 0, totalCost: 0, profit: 0, orders: 0 },
      ),
    [shops],
  );

  return (
    <Card className="border shadow-none overflow-hidden">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Shop performance</CardTitle>
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {shops.length} {shops.length === 1 ? "shop" : "shops"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {ranked.length === 0 ? (
          <div className="py-12 text-center">
            <Store className="size-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No shop data for this period.</p>
          </div>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-[40px_minmax(180px,2fr)_80px_120px_120px_minmax(180px,1.6fr)] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70 border-b bg-muted/15">
              <div>Rank</div>
              <div>Shop</div>
              <div className="text-center">Orders</div>
              <div className="text-right">Sales</div>
              <div className="text-right">Cost</div>
              <div className="text-right">Profit · share</div>
            </div>
            <ul className="divide-y">
              {ranked.map((shop, idx) => (
                <ShopRow
                  key={shop.shopName}
                  shop={shop}
                  rank={idx + 1}
                  maxProfit={maxProfit}
                  show={show}
                />
              ))}
            </ul>
            <div className="grid grid-cols-[40px_minmax(180px,2fr)_80px_120px_120px_minmax(180px,1.6fr)] gap-3 px-4 py-2.5 border-t bg-muted/20 text-xs font-semibold">
              <div />
              <div className="uppercase text-[10px] tracking-[0.12em] text-muted-foreground/80">Total</div>
              <div className="text-center tabular-nums">{maskedNum(totals.orders, show)}</div>
              <div className="text-right tabular-nums">{maskedCompact(totals.totalSales, show)}</div>
              <div className="text-right tabular-nums">{maskedCompact(totals.totalCost, show)}</div>
              <div className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                {maskedCompact(totals.profit, show)}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ShopRow({
  shop,
  rank,
  maxProfit,
  show,
}: {
  shop: ShopData;
  rank: number;
  maxProfit: number;
  show: boolean;
}) {
  const profitPct = (Math.abs(shop.profit) / maxProfit) * 100;
  const isPositive = shop.profit >= 0;

  return (
    <li className="px-4 py-3 hover:bg-muted/20 transition-colors">
      {/* Desktop */}
      <div className="hidden md:grid grid-cols-[40px_minmax(180px,2fr)_80px_120px_120px_minmax(180px,1.6fr)] gap-3 items-center">
        <RankBadge rank={rank} />
        <div className="min-w-0 flex items-center gap-2">
          <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
            <Store className="size-3.5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium truncate">{shop.shopName}</p>
        </div>
        <div className="text-center text-sm tabular-nums">{maskedNum(shop.orders, show)}</div>
        <div className="text-right text-sm tabular-nums">{maskedCompact(shop.totalSales, show)}</div>
        <div className="text-right text-sm tabular-nums">{maskedCompact(shop.totalCost, show)}</div>
        <div className="flex items-center gap-2 justify-end">
          <ShareBar percent={profitPct} positive={isPositive} />
          <span
            className={`text-sm font-semibold tabular-nums shrink-0 w-[80px] text-right ${
              isPositive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
            }`}
          >
            {maskedCompact(shop.profit, show)}
          </span>
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        <div className="flex items-center gap-3 mb-2">
          <RankBadge rank={rank} />
          <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
            <Store className="size-3.5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium truncate flex-1">{shop.shopName}</p>
          <span
            className={`text-sm font-bold tabular-nums shrink-0 ${
              isPositive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
            }`}
          >
            {maskedCompact(shop.profit, show)}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-11 text-[11px] text-muted-foreground tabular-nums">
          <span>{maskedNum(shop.orders, show)} orders</span>
          <span>· {maskedCompact(shop.totalSales, show)} sales</span>
        </div>
        <div className="ml-11 mt-2">
          <ShareBar percent={profitPct} positive={isPositive} />
        </div>
      </div>
    </li>
  );
}

// ─────────────────────────── RankBadge & ShareBar ───────────────────────────

/**
 * Podium-aware rank badge.
 *  1st → amber (gold)
 *  2nd → slate (silver)
 *  3rd → orange (bronze)
 *  4+  → muted, monospace number
 */
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="size-7 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 ring-1 ring-amber-300/60 dark:ring-amber-500/30">
        <Crown className="size-3.5" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="size-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums">
        02
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="size-7 rounded-full bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-400 text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums">
        03
      </div>
    );
  }
  return (
    <div className="size-7 rounded-full bg-muted/60 text-muted-foreground text-[11px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
      {String(rank).padStart(2, "0")}
    </div>
  );
}

/**
 * Horizontal share bar — emerald for positive profit, rose for negative.
 * Width scales 0–100 from the row's percent. Fixed width keeps the column
 * stable across rows.
 */
function ShareBar({ percent, positive }: { percent: number; positive: boolean }) {
  const fill = positive
    ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
    : "bg-gradient-to-r from-rose-400 to-rose-500";
  return (
    <div className="hidden lg:block h-1.5 w-[90px] rounded-full bg-muted overflow-hidden shrink-0">
      <div
        className={`h-full rounded-full transition-all duration-500 ${fill}`}
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

// ─────────────────────────── LoadingSkeleton ───────────────────────────

/**
 * Page-shape skeleton — shown during the first cold load (30–60s for a
 * fresh team scope). Keeps the layout from jumping when data arrives.
 */
function LoadingSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="border shadow-none">
            <CardContent className="p-4">
              <Skeleton className="size-8 rounded-lg mb-3" />
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-7 w-24 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border shadow-none">
        <CardHeader className="pb-3 border-b">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-3 border-b">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 border-r last:border-r-0">
                <Skeleton className="h-3 w-16 mb-2" />
                <Skeleton className="h-6 w-24 mb-1" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
          <div className="px-4 py-4">
            <Skeleton className="h-[240px] w-full" />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="border shadow-none">
            <CardContent className="py-3.5 px-4 flex items-center gap-3">
              <Skeleton className="size-10 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border shadow-none">
        <CardHeader className="pb-3 border-b">
          <Skeleton className="h-4 w-44" />
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2.5 w-20" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
