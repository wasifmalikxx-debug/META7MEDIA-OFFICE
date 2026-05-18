"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  RotateCw,
  TrendingUp,
  Users,
  Clock,
  Zap,
  Gauge,
  Ban,
  ShieldCheck,
  Check,
  AlertTriangle,
  Building2,
  Crown,
  Target,
  Heart,
  Calendar,
  DollarSign,
  TrendingDown,
  Shuffle,
} from "lucide-react";

// ─── API response types (mirror seo-autopilot-quota.service.ts) ─────

interface TeamStatsEntry {
  userId: string;
  employeeId: string;
  name: string;
  role: string;
  department: string;
  countToday: number;
  countYesterday: number;
  count7Day: number;
  countMtd: number;
  countAllTime: number;
  isOverLimit: boolean;
  allowedCount: number;
  reviewCount: number;
  blockedCount: number;
  lastGeneratedAt: string | null;
  costTodayUsd: number;
  cost7DayUsd: number;
  costMtdUsd: number;
  costAllTimeUsd: number;
}

interface RecentGeneration {
  id: string;
  userId: string;
  employeeId: string;
  userName: string;
  userRole: string;
  sourceTitle: string;
  generatedTitle: string | null;
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  category: string | null;
  createdAt: string;
  estimatedCostUsd: number;
}

interface DailyTrendPoint {
  date: string;
  label: string;
  count: number;
  costUsd: number;
  allowedCount: number;
  reviewCount: number;
  blockedCount: number;
}

interface CostByOutcome {
  allowedUsd: number;
  reviewUsd: number;
  blockedUsd: number;
  allowedCount: number;
  reviewCount: number;
  blockedCount: number;
}

interface DepartmentBreakdown {
  name: string;
  shortTag: string;
  memberCount: number;
  activeUsersToday: number;
  countToday: number;
  count7Day: number;
  countMtd: number;
  countAllTime: number;
  costTodayUsd: number;
  cost7DayUsd: number;
  costMtdUsd: number;
  costAllTimeUsd: number;
  allowedCount: number;
  reviewCount: number;
  blockedCount: number;
}

interface TeamStats {
  today: string;
  monthLabel: string;
  limit: number;
  totalToday: number;
  totalYesterday: number;
  total7Day: number;
  totalMtd: number;
  totalAllTime: number;
  costTodayUsd: number;
  costYesterdayUsd: number;
  cost7DayUsd: number;
  costMtdUsd: number;
  costAllTimeUsd: number;
  tagSwapsToday: number;
  tagSwaps7Day: number;
  tagSwapCostTodayUsd: number;
  tagSwapCost7DayUsd: number;
  activeUsersToday: number;
  activeUsers7Day: number;
  blockedToday: number;
  blocked7Day: number;
  avgCostPerGen7DayUsd: number;
  dailyTrend: DailyTrendPoint[];
  costByOutcome7d: CostByOutcome;
  departments: DepartmentBreakdown[];
  entries: TeamStatsEntry[];
  recent: RecentGeneration[];
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function relativePktTime(iso: string): string {
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function roleLabel(role: string): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "CEO";
    case "HR_ADMIN":
      return "HR";
    case "PARTNER":
      return "Partner";
    case "MANAGER":
      return "Manager";
    case "EMPLOYEE":
      return "Employee";
    default:
      return role;
  }
}

function roleColor(role: string): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-violet-500/30";
    case "HR_ADMIN":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30";
    case "PARTNER":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30";
    case "MANAGER":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30";
    default:
      return "bg-muted/60 text-foreground/70 ring-border";
  }
}

// Pick a stable gradient hue from any string (for avatars / dept chips).
function hueFromString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % 360;
}

// ─── Main component ─────────────────────────────────────────────────

export function SeoAutopilotDashboardView() {
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/seo-autopilot/usage?stats=true", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Failed (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.stats) {
          setStats(data.stats);
          setError(null);
        } else {
          setError("No stats returned from server");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error || !stats) {
    return (
      <Card className="border-rose-300/50 bg-rose-50/40 dark:bg-rose-950/20">
        <CardContent className="p-6 flex items-start gap-3">
          <AlertTriangle className="size-5 text-rose-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-rose-900 dark:text-rose-200">
              Couldn&apos;t load dashboard
            </p>
            <p className="text-[12px] text-rose-700/90 mt-1">{error ?? "Unknown error"}</p>
            <button
              type="button"
              onClick={handleRefresh}
              className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold underline hover:no-underline"
            >
              <RotateCw className="size-3" /> Try again
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        stats={stats}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />

      <KpiHeroRow stats={stats} />

      <CostBreakdownStrip stats={stats} />

      <TwoColumnSection>
        <DailyTrendCard trend={stats.dailyTrend} />
        <OutcomeBreakdownCard breakdown={stats.costByOutcome7d} />
      </TwoColumnSection>

      <DepartmentsSection departments={stats.departments} />

      <EmployeesSection entries={stats.entries} limit={stats.limit} />

      <ActivityFeedSection events={stats.recent} />

      <FooterNote limit={stats.limit} />
    </div>
  );
}

// ─── Cost breakdown strip (Today / Yesterday / 7-day / MTD / All-time)
//
// A dedicated five-column card right under the KPI hero. The KPI hero
// answers "what's happening today?"; this strip answers "what have we
// spent?" across every reporting window the dashboard supports. Five
// equal cells, hairline divider, USD values in tabular-nums so the
// columns line up. Each cell also shows the gen count so the cost is
// instantly interpretable ("$12.40 from 318 gens"). Hidden from the
// rest of the dashboard so we never have to ask "what window is this?"

function CostBreakdownStrip({ stats }: { stats: TeamStats }) {
  const cells: Array<{
    label: string;
    sub: string;
    cost: number;
    count: number;
    accent: "muted" | "violet" | "orange" | "emerald" | "sky";
  }> = [
    {
      label: "Today",
      sub: "Current PKT day",
      cost: stats.costTodayUsd,
      count: stats.totalToday,
      accent: "violet",
    },
    {
      label: "Yesterday",
      sub: "Previous PKT day",
      cost: stats.costYesterdayUsd,
      count: stats.totalYesterday,
      accent: "muted",
    },
    {
      label: "Last 7 days",
      sub: "Rolling week",
      cost: stats.cost7DayUsd,
      count: stats.total7Day,
      accent: "orange",
    },
    {
      label: "Month-to-date",
      sub: stats.monthLabel,
      cost: stats.costMtdUsd,
      count: stats.totalMtd,
      accent: "emerald",
    },
    {
      label: "All-time",
      sub: "Since launch",
      cost: stats.costAllTimeUsd,
      count: stats.totalAllTime,
      accent: "sky",
    },
  ];

  return (
    <Card
      className="border border-border/60 ap-stagger-in overflow-hidden"
      style={{ animationDelay: "200ms" }}
    >
      <CardContent className="p-0">
        <div className="px-6 sm:px-7 pt-5 pb-3 flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-gradient-to-br from-violet-500/15 to-emerald-500/15 ring-1 ring-violet-500/30 flex items-center justify-center">
            <DollarSign className="size-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              Spend summary
            </p>
            <p className="text-[14px] font-bold tracking-tight leading-tight">
              Total cost across all teams and users
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border-t border-border/40">
          {cells.map((cell, i) => (
            <CostCell
              key={cell.label}
              {...cell}
              showLeftBorder={i > 0}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CostCell({
  label,
  sub,
  cost,
  count,
  accent,
  showLeftBorder,
}: {
  label: string;
  sub: string;
  cost: number;
  count: number;
  accent: "muted" | "violet" | "orange" | "emerald" | "sky";
  showLeftBorder: boolean;
}) {
  const accentText = {
    muted: "text-muted-foreground",
    violet: "text-violet-600 dark:text-violet-400",
    orange: "text-orange-600 dark:text-orange-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    sky: "text-sky-600 dark:text-sky-400",
  }[accent];
  const accentDot = {
    muted: "bg-muted-foreground/40",
    violet: "bg-violet-500",
    orange: "bg-orange-500",
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
  }[accent];

  return (
    <div
      className={`relative px-5 py-4 ${showLeftBorder ? "lg:border-l border-border/40" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`size-1.5 rounded-full ${accentDot}`} />
        <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${accentText}`}>
          {label}
        </p>
      </div>
      <p className="text-2xl font-bold tabular-nums leading-tight mt-1.5">
        {formatUsd(cost)}
      </p>
      <p className="text-[10px] tabular-nums text-muted-foreground mt-0.5">
        {count.toLocaleString()} {count === 1 ? "gen" : "gens"} · {sub}
      </p>
    </div>
  );
}

// ─── Loading skeleton ───────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="ap-stagger-in">
        <CardContent className="p-6 flex items-center gap-4">
          <div className="size-12 rounded-2xl bg-muted/40 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 bg-muted/40 rounded animate-pulse" />
            <div className="h-3 w-64 bg-muted/30 rounded animate-pulse" />
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-xl bg-muted/30 animate-pulse ap-stagger-in"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
      <div
        className="h-64 rounded-xl bg-muted/30 animate-pulse ap-stagger-in"
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────

function DashboardHeader({
  stats,
  refreshing,
  onRefresh,
}: {
  stats: TeamStats;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card className="relative overflow-hidden border border-border/60 shadow-lg shadow-violet-500/5 ap-stagger-in">
      {/* Aurora wash */}
      <div
        aria-hidden
        className="absolute -top-24 -right-12 size-[420px] rounded-full blur-3xl opacity-50 ap-aurora-2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(124,58,237,0.35), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-20 -left-10 size-[360px] rounded-full blur-3xl opacity-40 ap-aurora-3"
        style={{
          background:
            "radial-gradient(closest-side, rgba(241,100,30,0.25), transparent 70%)",
        }}
      />

      <CardContent className="relative p-7 sm:p-8 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-2xl bg-violet-400/30 blur-md ap-orb-pulse"
            />
            <div className="relative size-14 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 ring-1 ring-violet-700/30 flex items-center justify-center shadow-xl shadow-violet-500/30">
              <TrendingUp className="size-7 text-white" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-[0.22em] flex items-center gap-1.5">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
              Live · admin
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight mt-1">
              Autopilot Dashboard
            </h1>
            <p className="text-[12px] sm:text-[13px] text-muted-foreground mt-1.5 leading-relaxed max-w-lg">
              Real-time spend, usage and audit trail across every department.
              Reset at midnight Pakistan time.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex flex-col items-end text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Today
            </p>
            <p className="text-[14px] font-bold tabular-nums">{stats.today}</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-semibold border border-border/70 hover:bg-muted/60 hover:border-violet-500/40 text-foreground/80 transition-colors disabled:opacity-50"
          >
            <RotateCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── KPI hero row ───────────────────────────────────────────────────

function KpiHeroRow({ stats }: { stats: TeamStats }) {
  const gensDelta = stats.totalToday - stats.totalYesterday;
  const costDelta = stats.costTodayUsd - stats.costYesterdayUsd;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5">
      <BigKpiCard
        label="Gens today"
        value={stats.totalToday}
        tone="emerald"
        icon={Zap}
        delta={gensDelta}
        animationDelay={0}
      />
      <BigKpiCard
        label="Spend today"
        value={formatUsd(stats.costTodayUsd)}
        tone="violet"
        icon={DollarSign}
        deltaText={
          costDelta === 0
            ? null
            : `${costDelta > 0 ? "+" : "−"}${formatUsd(Math.abs(costDelta))}`
        }
        deltaPositive={costDelta < 0}
        animationDelay={60}
      />
      <BigKpiCard
        label="Active today"
        value={stats.activeUsersToday}
        tone="sky"
        icon={Users}
        subtitle={
          stats.activeUsers7Day > stats.activeUsersToday
            ? `${stats.activeUsers7Day} this week`
            : "this week"
        }
        animationDelay={120}
      />
      <BigKpiCard
        label="Blocked today"
        value={stats.blockedToday}
        tone={stats.blockedToday > 0 ? "rose" : "muted"}
        icon={Ban}
        subtitle={
          stats.blocked7Day > 0 ? `${stats.blocked7Day} this week` : "all clean"
        }
        animationDelay={180}
      />
      <BigKpiCard
        label="Week total"
        value={stats.total7Day}
        tone="orange"
        icon={Calendar}
        subtitle={`${formatUsd(stats.cost7DayUsd)} spent`}
        animationDelay={240}
      />
      <BigKpiCard
        label="Avg / gen"
        value={formatUsd(stats.avgCostPerGen7DayUsd)}
        tone="amber"
        icon={Gauge}
        subtitle="rolling 7d (gens only)"
        animationDelay={300}
      />
      <BigKpiCard
        label="Tag swaps today"
        value={stats.tagSwapsToday}
        tone="rose"
        icon={Shuffle}
        subtitle={
          stats.tagSwapCostTodayUsd > 0
            ? `${formatUsd(stats.tagSwapCostTodayUsd)} spent`
            : stats.tagSwaps7Day > 0
              ? `${stats.tagSwaps7Day} this week`
              : "no swaps today"
        }
        animationDelay={360}
      />
    </div>
  );
}

function BigKpiCard({
  label,
  value,
  icon: Icon,
  tone,
  delta,
  deltaText,
  deltaPositive,
  subtitle,
  animationDelay,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "violet" | "sky" | "rose" | "muted" | "orange" | "amber";
  delta?: number;
  deltaText?: string | null;
  deltaPositive?: boolean;
  subtitle?: string;
  animationDelay?: number;
}) {
  const toneClass = {
    emerald:
      "from-emerald-500/15 via-emerald-500/8 to-transparent ring-emerald-500/25 text-emerald-700 dark:text-emerald-400",
    violet:
      "from-violet-500/15 via-violet-500/8 to-transparent ring-violet-500/25 text-violet-700 dark:text-violet-400",
    sky: "from-sky-500/15 via-sky-500/8 to-transparent ring-sky-500/25 text-sky-700 dark:text-sky-400",
    rose: "from-rose-500/15 via-rose-500/8 to-transparent ring-rose-500/25 text-rose-700 dark:text-rose-400",
    muted:
      "from-muted/50 via-muted/30 to-transparent ring-border text-muted-foreground",
    orange:
      "from-orange-500/15 via-orange-500/8 to-transparent ring-orange-500/25 text-orange-700 dark:text-orange-400",
    amber:
      "from-amber-500/15 via-amber-500/8 to-transparent ring-amber-500/25 text-amber-700 dark:text-amber-400",
  }[tone];

  let deltaNode: React.ReactNode = null;
  if (deltaText) {
    deltaNode = (
      <span
        className={`inline-flex items-center gap-0.5 text-[9px] font-bold tabular-nums ${
          deltaPositive
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400"
        }`}
      >
        {deltaPositive ? (
          <TrendingDown className="size-2.5" />
        ) : (
          <TrendingUp className="size-2.5" />
        )}
        {deltaText} vs yest.
      </span>
    );
  } else if (typeof delta === "number" && delta !== 0) {
    const positive = delta > 0;
    deltaNode = (
      <span
        className={`inline-flex items-center gap-0.5 text-[9px] font-bold tabular-nums ${
          positive
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400"
        }`}
      >
        {positive ? (
          <TrendingUp className="size-2.5" />
        ) : (
          <TrendingDown className="size-2.5" />
        )}
        {positive ? "+" : ""}
        {delta} vs yest.
      </span>
    );
  } else if (subtitle) {
    deltaNode = (
      <span className="text-[9px] font-semibold text-muted-foreground tabular-nums">
        {subtitle}
      </span>
    );
  }

  return (
    <div
      className={`relative rounded-xl bg-gradient-to-br ring-1 px-3.5 py-3 overflow-hidden ap-stagger-in ${toneClass}`}
      style={{ animationDelay: `${animationDelay ?? 0}ms` }}
    >
      <Icon aria-hidden className="absolute right-2 top-2 size-3.5 opacity-25" />
      <p className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-75 pr-5">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums leading-tight mt-1 text-foreground">
        {value}
      </p>
      {deltaNode && <div className="mt-1">{deltaNode}</div>}
    </div>
  );
}

// ─── 2-column grid wrapper ──────────────────────────────────────────

function TwoColumnSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 ap-stagger-in" style={{ animationDelay: "360ms" }}>
      {children}
    </div>
  );
}

// ─── Daily trend chart card ─────────────────────────────────────────

function DailyTrendCard({ trend }: { trend: DailyTrendPoint[] }) {
  const max = Math.max(1, ...trend.map((d) => d.count));
  const todayIdx = trend.findIndex((d) => d.label === "Today");
  return (
    <Card className="lg:col-span-3 border border-border/60">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-violet-600 dark:text-violet-400" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Daily trend
              </p>
              <p className="text-[14px] font-bold tracking-tight">
                Last 7 days
              </p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            Hover any bar for detail
          </p>
        </div>

        <div className="flex items-end gap-2 h-40 px-1">
          {trend.map((d, i) => {
            const heightPct = (d.count / max) * 100;
            const isToday = i === todayIdx;
            const isEmpty = d.count === 0;
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center justify-end gap-1.5 group cursor-default"
              >
                <div className="relative w-full flex flex-col items-center justify-end h-full">
                  {/* Tooltip */}
                  <div
                    className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 bg-card border border-border rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
                    role="tooltip"
                  >
                    <p className="text-[11px] font-bold">{d.label}</p>
                    <p className="text-[10px] tabular-nums text-muted-foreground mt-0.5">
                      {d.count} gens · {formatUsd(d.costUsd)}
                    </p>
                    {d.count > 0 && (
                      <p className="text-[9px] tabular-nums text-muted-foreground/70 mt-0.5">
                        ✓ {d.allowedCount} ⚠ {d.reviewCount} ⊘ {d.blockedCount}
                      </p>
                    )}
                  </div>
                  <div
                    className={`w-full rounded-md transition-all group-hover:opacity-95 ap-bar-fill ${
                      isEmpty
                        ? "bg-muted/40"
                        : isToday
                          ? "bg-gradient-to-t from-orange-500 via-pink-500 to-violet-500 shadow-md shadow-violet-500/30"
                          : "bg-gradient-to-t from-violet-500 to-violet-400"
                    }`}
                    style={{
                      height: isEmpty ? "4px" : `${Math.max(8, heightPct)}%`,
                      ["--bar-w" as string]: "100%",
                      animationDelay: `${i * 70}ms`,
                    }}
                  />
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <p
                    className={`text-[10px] font-bold tabular-nums ${
                      isToday
                        ? "text-violet-600 dark:text-violet-400"
                        : "text-muted-foreground/80"
                    }`}
                  >
                    {d.label}
                  </p>
                  <p className="text-[9px] tabular-nums text-muted-foreground/60">
                    {d.count}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Cost-by-outcome card ───────────────────────────────────────────

function OutcomeBreakdownCard({ breakdown }: { breakdown: CostByOutcome }) {
  const total = breakdown.allowedUsd + breakdown.reviewUsd + breakdown.blockedUsd;
  const totalCount =
    breakdown.allowedCount + breakdown.reviewCount + breakdown.blockedCount;
  const pct = (n: number): number =>
    total > 0 ? Math.round((n / total) * 100) : 0;
  const allowedPct = pct(breakdown.allowedUsd);
  const reviewPct = pct(breakdown.reviewUsd);
  const blockedPct = totalCount > 0 ? 100 - allowedPct - reviewPct : 0;

  return (
    <Card className="lg:col-span-2 border border-border/60">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              Cost by outcome
            </p>
            <p className="text-[14px] font-bold tracking-tight">7-day split</p>
          </div>
        </div>

        {totalCount === 0 ? (
          <p className="text-[12px] text-muted-foreground italic text-center py-6">
            No generations yet
          </p>
        ) : (
          <>
            <div className="h-3.5 w-full rounded-full overflow-hidden flex bg-muted/40 ring-1 ring-border/40">
              {breakdown.allowedUsd > 0 && (
                <div
                  className="bg-emerald-500 ap-bar-fill"
                  style={{
                    width: `${allowedPct}%`,
                    ["--bar-w" as string]: "100%",
                  }}
                />
              )}
              {breakdown.reviewUsd > 0 && (
                <div
                  className="bg-amber-500 ap-bar-fill"
                  style={{
                    width: `${reviewPct}%`,
                    ["--bar-w" as string]: "100%",
                  }}
                />
              )}
              {breakdown.blockedUsd > 0 && (
                <div
                  className="bg-rose-500 ap-bar-fill"
                  style={{
                    width: `${blockedPct}%`,
                    ["--bar-w" as string]: "100%",
                  }}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <OutcomeLegendRow
                color="emerald"
                label="Allowed"
                count={breakdown.allowedCount}
                cost={breakdown.allowedUsd}
                pct={allowedPct}
              />
              <OutcomeLegendRow
                color="amber"
                label="Review"
                count={breakdown.reviewCount}
                cost={breakdown.reviewUsd}
                pct={reviewPct}
              />
              <OutcomeLegendRow
                color="rose"
                label="Blocked"
                count={breakdown.blockedCount}
                cost={breakdown.blockedUsd}
                pct={blockedPct}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomeLegendRow({
  color,
  label,
  count,
  cost,
  pct,
}: {
  color: "emerald" | "amber" | "rose";
  label: string;
  count: number;
  cost: number;
  pct: number;
}) {
  const dotClass = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  }[color];
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/20 transition-colors">
      <span className={`size-2 rounded-full ${dotClass} shrink-0`} />
      <span className="text-[11px] font-bold flex-1">{label}</span>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {count} gens
      </span>
      <span className="text-[11px] font-bold tabular-nums w-14 text-right">
        {formatUsd(cost)}
      </span>
      <span className="text-[10px] font-bold tabular-nums text-muted-foreground w-9 text-right">
        {pct}%
      </span>
    </div>
  );
}

// ─── Department breakdown section ───────────────────────────────────

function DepartmentsSection({
  departments,
}: {
  departments: DepartmentBreakdown[];
}) {
  return (
    <Card
      className="border border-border/60 ap-stagger-in"
      style={{ animationDelay: "440ms" }}
    >
      <CardContent className="p-6 sm:p-7 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-gradient-to-br from-orange-500/15 to-violet-500/15 ring-1 ring-orange-500/30 flex items-center justify-center">
              <Building2 className="size-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Teams
              </p>
              <p className="text-[16px] font-bold tracking-tight">
                Spend per team · today, 7-day, MTD, all-time
              </p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {departments.length}{" "}
            {departments.length === 1 ? "team" : "teams"} with activity in the
            last 7 days
          </p>
        </div>

        {departments.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No department activity"
            sub="No generations across any team in the last 7 days."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {departments.map((d, i) => (
              <DepartmentCard
                key={d.name}
                dept={d}
                maxCount7Day={Math.max(
                  ...departments.map((x) => x.count7Day),
                  1,
                )}
                animationDelay={i * 60}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DepartmentCard({
  dept,
  maxCount7Day,
  animationDelay,
}: {
  dept: DepartmentBreakdown;
  maxCount7Day: number;
  animationDelay: number;
}) {
  const hue = hueFromString(dept.name);
  const sharePct = Math.round((dept.count7Day / maxCount7Day) * 100);
  const total = dept.allowedCount + dept.reviewCount + dept.blockedCount;
  const allowedPct = total > 0 ? (dept.allowedCount / total) * 100 : 0;
  const reviewPct = total > 0 ? (dept.reviewCount / total) * 100 : 0;
  const blockedPct = total > 0 ? (dept.blockedCount / total) * 100 : 0;

  return (
    <div
      className="rounded-xl border border-border/60 bg-card hover:bg-muted/15 transition-colors p-4 space-y-3 ap-stagger-in"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Header: dept name + active indicator */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="size-9 rounded-lg ring-1 flex items-center justify-center shrink-0 text-[11px] font-bold text-white"
            style={{
              background: `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 40) % 360} 70% 45%))`,
            }}
          >
            {dept.shortTag.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight truncate">
              {dept.name}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
              {dept.memberCount}{" "}
              {dept.memberCount === 1 ? "member" : "members"} ·{" "}
              {dept.activeUsersToday} active today
            </p>
          </div>
        </div>
        {dept.activeUsersToday > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[9px] font-bold tabular-nums">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        )}
      </div>

      {/* 4-window stat grid — Today / 7-day / MTD / All-time. Each tile
          shows gen count on top, cost underneath. Compact so the four
          fit on a 2x2 on narrow widths and 4x1 at md+. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <DeptStatTile
          label="Today"
          count={dept.countToday}
          cost={dept.costTodayUsd}
        />
        <DeptStatTile
          label="7-day"
          count={dept.count7Day}
          cost={dept.cost7DayUsd}
        />
        <DeptStatTile
          label="MTD"
          count={dept.countMtd}
          cost={dept.costMtdUsd}
        />
        <DeptStatTile
          label="All-time"
          count={dept.countAllTime}
          cost={dept.costAllTimeUsd}
          highlight
        />
      </div>

      {/* Share-of-week bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          <span>Share of week</span>
          <span className="tabular-nums">{sharePct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-violet-500 ap-bar-fill"
            style={{
              ["--bar-w" as string]: `${sharePct}%`,
            }}
          />
        </div>
      </div>

      {/* Outcome split bar */}
      {total > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Outcome split
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden flex">
            {dept.allowedCount > 0 && (
              <div
                className="bg-emerald-500 ap-bar-fill"
                style={{
                  width: `${allowedPct}%`,
                  ["--bar-w" as string]: "100%",
                }}
                title={`${dept.allowedCount} allowed`}
              />
            )}
            {dept.reviewCount > 0 && (
              <div
                className="bg-amber-500 ap-bar-fill"
                style={{
                  width: `${reviewPct}%`,
                  ["--bar-w" as string]: "100%",
                }}
                title={`${dept.reviewCount} review`}
              />
            )}
            {dept.blockedCount > 0 && (
              <div
                className="bg-rose-500 ap-bar-fill"
                style={{
                  width: `${blockedPct}%`,
                  ["--bar-w" as string]: "100%",
                }}
                title={`${dept.blockedCount} blocked`}
              />
            )}
          </div>
          <div className="flex items-center gap-3 text-[9px] tabular-nums text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {dept.allowedCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-amber-500" />
              {dept.reviewCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-rose-500" />
              {dept.blockedCount}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One stat tile inside a department card. `highlight` swaps the bg
 * to a subtle emerald tint — used for the All-time tile so the user's
 * eye lands on the lifetime total at a glance.
 */
function DeptStatTile({
  label,
  count,
  cost,
  highlight,
}: {
  label: string;
  count: number;
  cost: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg ring-1 px-2.5 py-1.5 ${
        highlight
          ? "bg-emerald-500/10 ring-emerald-500/30"
          : "bg-muted/30 ring-border/40"
      }`}
    >
      <p
        className={`text-[9px] font-bold uppercase tracking-[0.16em] ${
          highlight
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground/80"
        }`}
      >
        {label}
      </p>
      <p className="text-base font-bold tabular-nums leading-tight mt-0.5">
        {count.toLocaleString()}
        <span className="text-[10px] font-bold ml-1 opacity-60">gens</span>
      </p>
      <p
        className={`text-[10px] tabular-nums ${
          highlight
            ? "text-emerald-700/85 dark:text-emerald-300/85 font-semibold"
            : "text-muted-foreground"
        }`}
      >
        {formatUsd(cost)}
      </p>
    </div>
  );
}

// ─── Employees section (full table) ─────────────────────────────────

function EmployeesSection({
  entries,
  limit,
}: {
  entries: TeamStatsEntry[];
  limit: number;
}) {
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState<
    "today" | "week" | "mtd" | "allTime" | "cost7d" | "costMtd" | "costAllTime" | "name"
  >("costAllTime");

  const filtered = entries.filter((e) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      e.employeeId.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q) ||
      roleLabel(e.role).toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "today":
        return b.countToday - a.countToday || b.count7Day - a.count7Day;
      case "week":
        return b.count7Day - a.count7Day || b.countToday - a.countToday;
      case "mtd":
        return b.countMtd - a.countMtd || b.count7Day - a.count7Day;
      case "allTime":
        return b.countAllTime - a.countAllTime;
      case "cost7d":
        return b.cost7DayUsd - a.cost7DayUsd;
      case "costMtd":
        return b.costMtdUsd - a.costMtdUsd;
      case "costAllTime":
        return b.costAllTimeUsd - a.costAllTimeUsd;
      case "name":
        return a.name.localeCompare(b.name);
    }
  });

  // Per-window totals shown in the table footer — gives the CEO a
  // visible "sum" row beneath the per-employee breakdown so they can
  // sanity-check the dashboard's top-line spend numbers against the
  // table they're staring at.
  const footerTotals = sorted.reduce(
    (acc, e) => {
      acc.countToday += e.countToday;
      acc.countYesterday += e.countYesterday;
      acc.count7Day += e.count7Day;
      acc.countMtd += e.countMtd;
      acc.countAllTime += e.countAllTime;
      acc.cost7DayUsd += e.cost7DayUsd;
      acc.costMtdUsd += e.costMtdUsd;
      acc.costAllTimeUsd += e.costAllTimeUsd;
      return acc;
    },
    {
      countToday: 0,
      countYesterday: 0,
      count7Day: 0,
      countMtd: 0,
      countAllTime: 0,
      cost7DayUsd: 0,
      costMtdUsd: 0,
      costAllTimeUsd: 0,
    },
  );

  return (
    <Card
      className="border border-border/60 ap-stagger-in"
      style={{ animationDelay: "520ms" }}
    >
      <CardContent className="p-6 sm:p-7 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-gradient-to-br from-sky-500/15 to-violet-500/15 ring-1 ring-sky-500/30 flex items-center justify-center">
              <Users className="size-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Employees
              </p>
              <p className="text-[16px] font-bold tracking-tight">
                Per-user spend across every window
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, ID, dept…"
              className="h-8 px-2.5 rounded-md text-[12px] border border-border/70 bg-card focus:outline-none focus:ring-1 focus:ring-violet-500/40 w-44"
            />
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as typeof sortBy,
                )
              }
              className="h-8 px-2 rounded-md text-[12px] font-semibold border border-border/70 bg-card cursor-pointer"
            >
              <optgroup label="Spend">
                <option value="costAllTime">All-time spend</option>
                <option value="costMtd">MTD spend</option>
                <option value="cost7d">7-day spend</option>
              </optgroup>
              <optgroup label="Volume">
                <option value="allTime">All-time gens</option>
                <option value="mtd">MTD gens</option>
                <option value="week">7-day gens</option>
                <option value="today">Today's gens</option>
              </optgroup>
              <optgroup label="Other">
                <option value="name">Name</option>
              </optgroup>
            </select>
          </div>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            icon={Users}
            title={filter ? "No matching users" : "No employee activity yet"}
            sub={
              filter
                ? "Try a different search term."
                : "Generations will appear here as the team uses Autopilot."
            }
          />
        ) : (
          <div className="rounded-xl border border-border/60 overflow-hidden">
            {/* Horizontal scroll wrapper — the cost-breakdown columns push
                this past the available width on tablet/narrow desktop;
                we let it scroll horizontally inside its own card rather
                than collapse columns. */}
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] min-w-[1080px]">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-bold text-left">User</th>
                    <th className="px-3 py-2.5 font-bold text-left">Dept</th>
                    <th className="px-3 py-2.5 font-bold text-left">Role</th>
                    <th className="px-3 py-2.5 font-bold text-right">Today</th>
                    <th className="px-3 py-2.5 font-bold text-right">7-day</th>
                    <th className="px-3 py-2.5 font-bold text-right">MTD</th>
                    <th className="px-3 py-2.5 font-bold text-right">All-time</th>
                    <th className="px-3 py-2.5 font-bold text-left">
                      Outcomes
                    </th>
                    <th className="px-3 py-2.5 font-bold text-right">
                      Spend 7d
                    </th>
                    <th className="px-3 py-2.5 font-bold text-right">
                      Spend MTD
                    </th>
                    <th className="px-3 py-2.5 font-bold text-right bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      Spend all-time
                    </th>
                    <th className="px-3 py-2.5 font-bold text-right">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((e, i) => (
                    <EmployeeRow
                      key={e.userId}
                      entry={e}
                      limit={limit}
                      animationDelay={i * 22}
                    />
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 border-t-2 border-border text-[11px] font-bold">
                  <tr>
                    <td className="px-3 py-2.5 text-left">
                      <span className="uppercase tracking-[0.16em] text-[10px] text-muted-foreground">
                        Totals
                      </span>
                    </td>
                    <td className="px-3 py-2.5" colSpan={2} />
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {footerTotals.countToday}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {footerTotals.count7Day}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {footerTotals.countMtd}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {footerTotals.countAllTime.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatUsd(footerTotals.cost7DayUsd)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatUsd(footerTotals.costMtdUsd)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      {formatUsd(footerTotals.costAllTimeUsd)}
                    </td>
                    <td className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmployeeRow({
  entry,
  limit,
  animationDelay,
}: {
  entry: TeamStatsEntry;
  limit: number;
  animationDelay: number;
}) {
  const hue = hueFromString(entry.name);
  const initials = entry.name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const todayPct =
    entry.role === "SUPER_ADMIN"
      ? 0
      : Math.min(100, (entry.countToday / limit) * 100);

  return (
    <tr
      className="border-t border-border/40 hover:bg-muted/15 transition-colors ap-stagger-in"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <td className="px-3 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="size-8 rounded-full ring-1 ring-white/20 flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
            style={{
              background: `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 40) % 360} 70% 45%))`,
            }}
          >
            {initials || "?"}
          </div>
          <div className="min-w-0">
            <p className="font-bold leading-tight truncate">{entry.name}</p>
            <p className="text-[10px] tabular-nums text-muted-foreground/70 font-medium leading-tight">
              {entry.employeeId}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex items-center rounded-md bg-muted/40 ring-1 ring-border/40 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap">
          {entry.department}
        </span>
      </td>
      <td className="px-3 py-3">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${roleColor(entry.role)}`}
        >
          {roleLabel(entry.role)}
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        {entry.role === "SUPER_ADMIN" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 ring-1 ring-violet-500/30 text-violet-700 dark:text-violet-300 px-2 py-0.5 text-[10px] font-bold tabular-nums">
            <Crown className="size-2.5" />
            {entry.countToday}
          </span>
        ) : (
          <div className="inline-flex flex-col items-end gap-1">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${
                entry.isOverLimit
                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30"
                  : entry.countToday / limit >= 0.8
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
                    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30"
              }`}
            >
              {entry.countToday}/{limit}
            </span>
            <div className="w-14 h-1 rounded-full bg-muted/60 overflow-hidden">
              <div
                className={`h-full ap-bar-fill ${
                  entry.isOverLimit
                    ? "bg-rose-500"
                    : entry.countToday / limit >= 0.8
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{
                  ["--bar-w" as string]: `${todayPct}%`,
                }}
              />
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-right tabular-nums font-semibold text-muted-foreground">
        {entry.count7Day}
      </td>
      <td className="px-3 py-3 text-right tabular-nums font-semibold text-muted-foreground">
        {entry.countMtd}
      </td>
      <td className="px-3 py-3 text-right tabular-nums font-bold">
        {entry.countAllTime.toLocaleString()}
      </td>
      <td className="px-3 py-3">
        <OutcomeMicroChips
          allowed={entry.allowedCount}
          review={entry.reviewCount}
          blocked={entry.blockedCount}
        />
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-[11px] text-muted-foreground">
        {formatUsd(entry.cost7DayUsd)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-[11px] text-muted-foreground">
        {formatUsd(entry.costMtdUsd)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums font-bold text-[11px] bg-emerald-500/5 text-emerald-700 dark:text-emerald-300">
        {formatUsd(entry.costAllTimeUsd)}
      </td>
      <td className="px-3 py-3 text-right text-[10px] text-muted-foreground tabular-nums">
        {entry.lastGeneratedAt ? relativePktTime(entry.lastGeneratedAt) : "—"}
      </td>
    </tr>
  );
}

function OutcomeMicroChips({
  allowed,
  review,
  blocked,
}: {
  allowed: number;
  review: number;
  blocked: number;
}) {
  if (allowed + review + blocked === 0) {
    return <span className="text-[10px] text-muted-foreground/60">—</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {allowed > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[9px] font-bold tabular-nums"
          title={`${allowed} allowed`}
        >
          <Check className="size-2.5" strokeWidth={3} />
          {allowed}
        </span>
      )}
      {review > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[9px] font-bold tabular-nums"
          title={`${review} review`}
        >
          <AlertTriangle className="size-2.5" />
          {review}
        </span>
      )}
      {blocked > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/15 ring-1 ring-rose-500/30 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 text-[9px] font-bold tabular-nums"
          title={`${blocked} blocked`}
        >
          <Ban className="size-2.5" />
          {blocked}
        </span>
      )}
    </div>
  );
}

// ─── Activity feed section ──────────────────────────────────────────

function ActivityFeedSection({ events }: { events: RecentGeneration[] }) {
  return (
    <Card
      className="border border-border/60 ap-stagger-in"
      style={{ animationDelay: "600ms" }}
    >
      <CardContent className="p-6 sm:p-7 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-gradient-to-br from-pink-500/15 to-violet-500/15 ring-1 ring-pink-500/30 flex items-center justify-center">
              <Clock className="size-4 text-pink-600 dark:text-pink-400" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Activity feed
              </p>
              <p className="text-[16px] font-bold tracking-tight">
                Latest {Math.min(50, events.length)} generations
              </p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {events.length} {events.length === 1 ? "event" : "events"} in last
            7 days
          </p>
        </div>

        {events.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No activity yet"
            sub="Generations will appear here, newest first."
          />
        ) : (
          <div className="space-y-2">
            {events.map((evt, i) => (
              <EventCard key={evt.id} evt={evt} animationDelay={i * 18} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventCard({
  evt,
  animationDelay,
}: {
  evt: RecentGeneration;
  animationDelay: number;
}) {
  const hue = hueFromString(evt.userName);
  const initials = evt.userName
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="rounded-xl border border-border/60 bg-card hover:bg-muted/15 transition-colors px-4 py-3 ap-stagger-in"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-9 rounded-full ring-1 ring-white/20 flex items-center justify-center shrink-0 text-[11px] font-bold text-white"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 40) % 360} 70% 45%))`,
          }}
        >
          {initials || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold leading-tight">
              {evt.userName}
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground/70 font-medium">
              {evt.employeeId}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${roleColor(evt.userRole)}`}
            >
              {roleLabel(evt.userRole)}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
              {relativePktTime(evt.createdAt)}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            <span className="text-muted-foreground/60 font-semibold uppercase tracking-wider text-[9px] mr-1.5">
              From
            </span>
            {evt.sourceTitle}
          </p>
          {evt.generatedTitle && (
            <p className="text-[12px] text-foreground/90 mt-1 truncate font-medium">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider text-[9px] mr-1.5">
                →
              </span>
              {evt.generatedTitle}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <VerdictPill verdict={evt.verdict} />
            {evt.category && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 ring-1 ring-border/40 rounded-md px-2 py-0.5">
                <Target className="size-2.5" />
                {evt.category}
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold tabular-nums bg-violet-500/10 ring-1 ring-violet-500/25 text-violet-700 dark:text-violet-300 rounded-md px-2 py-0.5"
              title="Estimated Anthropic cost"
            >
              <Gauge className="size-2.5" />
              {formatUsd(evt.estimatedCostUsd)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function VerdictPill({
  verdict,
}: {
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
}) {
  if (verdict === "ALLOWED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
        <Check className="size-2.5" strokeWidth={3} />
        Allowed
      </span>
    );
  }
  if (verdict === "REVIEW") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
        <AlertTriangle className="size-2.5" />
        Review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 ring-1 ring-rose-500/30 text-rose-700 dark:text-rose-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
      <Ban className="size-2.5" />
      Blocked
    </span>
  );
}

// ─── Empty state ────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  title,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
}) {
  return (
    <div className="text-center py-10 space-y-2">
      <div className="size-12 rounded-2xl bg-muted/40 ring-1 ring-border mx-auto flex items-center justify-center">
        <Icon className="size-5 text-muted-foreground/60" />
      </div>
      <p className="text-[13px] font-bold text-foreground/80">{title}</p>
      <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">{sub}</p>
    </div>
  );
}

// ─── Footer note ────────────────────────────────────────────────────

function FooterNote({ limit }: { limit: number }) {
  return (
    <Card className="border-border/40 bg-muted/10 shadow-none">
      <CardContent className="p-4 flex items-start gap-3">
        <Heart className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          Daily limit is <strong>{limit}</strong> generations per user (CEO
          unlimited). Tag swaps don&apos;t count toward the limit but their
          Anthropic cost is rolled into the &quot;Spend&quot; totals here.
          Cost numbers are <strong>actual</strong> — derived from
          Anthropic&apos;s{" "}
          <code className="bg-muted/40 rounded px-1">usage</code> response on
          every API call (gens + swaps). Should match the Anthropic console
          to within a fraction of a cent.
        </p>
      </CardContent>
    </Card>
  );
}
