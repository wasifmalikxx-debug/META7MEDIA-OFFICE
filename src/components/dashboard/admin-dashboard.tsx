"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  Wallet,
  AlertTriangle,
  Coffee,
  LogOut,
  CalendarOff,
  CalendarCheck2,
  CircleDot,
  Inbox,
  Smartphone,
  Star,
  MessageSquare,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  TrendingDown,
  FileText,
  Activity,
  Building2,
  Sparkles,
  CheckCircle2,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Receipt,
  Eye,
  EyeOff,
  Crown,
  Briefcase,
  PackageOpen,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { formatPKTDisplay, formatPKTTime } from "@/lib/pkt";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface EmployeeStatus {
  id: string;
  firstName: string;
  lastName: string | null;
  employeeId: string;
  empStatus: string;
  liveStatus: string;
  checkIn: string | null;
  checkOut: string | null;
  // Multi-office context — labels each Live Status row so the CEO can see
  // which team/office an employee belongs to without leaving the dashboard.
  teamName?: string | null;
  officeName?: string | null;
}

interface CommandCenterCounts {
  pendingLeaves: number;
  pendingDevices: number;
  pendingReviewBonuses: number;
  complaintsAwaitingReply: number;
}

interface TeamGroup {
  key: string;
  name: string;
  partnerName: string | null;
  departmentName: string;
  officeName: string;
  memberCount: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  onLeaveToday: number;
  // Total salary liability this month (every PayrollRecord, paid or not).
  monthPayable: number;
  // Salary still owed this month (status !== "PAID"). Drives the dedicated
  // pending-salary line so the CEO sees what's left to pay per team.
  monthPending: number;
  unpaidCount: number;
  paidCount: number;
  monthFines: number;
}

// ─── Financials (sheet-derived revenue/profit) ────────────────────────
// Pre-computed by the daily-report cron and read from DailyTeamSnapshot.
// All amounts are USD. See src/lib/services/dashboard-financials.ts for
// the canonical shape; this mirror lives here to keep the dashboard
// component self-typed.

interface MoneyBlock {
  orders: number;
  sale: number;
  cost: number;
  profit: number;
}
interface RefundBlock {
  count: number;
  loss: number;
  recovered: number;
}
interface TeamFinancials {
  teamKey: "em" | "ae" | "me" | "fb-hq" | "fb-o2";
  teamName: string | null;
  departmentName: string | null;
  officeSlug: string | null;
  today: MoneyBlock;
  mtd: MoneyBlock;
  lastMonthSameDay: MoneyBlock;
  lastMonthFull: MoneyBlock;
  refundsMtd: RefundBlock;
  refundsLastMonth: RefundBlock;
}
interface DashboardFinancials {
  perTeam: TeamFinancials[];
  combined: {
    today: MoneyBlock;
    mtd: MoneyBlock;
    lastMonthSameDay: MoneyBlock;
    lastMonthFull: MoneyBlock;
    refundsMtd: RefundBlock;
    refundsLastMonth: RefundBlock;
  };
  dailySeries: { date: string; sale: number; profit: number; orders: number }[];
  todayISO: string;
}

interface OfficeOption {
  id: string;
  slug: string;
  name: string;
  isPrimary: boolean;
}

interface AdminDashboardProps {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  totalPayable: number;
  totalFines: number;
  recentAttendances: any[];
  employeeStatuses: EmployeeStatus[];
  dayOffLabel?: string | null;
  attendanceTrend?: { day: string; present: number; absent: number }[];
  finesTrend?: { day: string; fines: number }[];
  todayReports?: number;
  topAbsent?: { name: string; employeeId: string; count: number }[];
  // Per-team aggregates (one card per team) — replaces the old hardcoded
  // Etsy / Facebook split. Includes both partner-led teams and CEO-direct
  // teams (OFFICE 1 Etsy, OFFICE 1 Facebook).
  teamGroups?: TeamGroup[];
  commandCenter?: CommandCenterCounts;
  // First name of the signed-in CEO/HR user — drives the "Good morning, X"
  // greeting in the hero header. Optional so legacy callers don't break.
  userName?: string;
  // Sheet-derived revenue / profit / refunds layer. Optional — when
  // missing, the financial sections gracefully degrade to "—" placeholders
  // (e.g. during the brief window between deploy and first cron run).
  financials?: DashboardFinancials;
  offices?: OfficeOption[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; icon: any }> = {
  PRESENT: { label: "Present", color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-500", icon: UserCheck },
  LATE: { label: "Late", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", dot: "bg-amber-500", icon: Clock },
  ON_BREAK: { label: "On Break", color: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400", dot: "bg-sky-500", icon: Coffee },
  CHECKED_OUT: { label: "Checked Out", color: "bg-slate-50 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400", dot: "bg-slate-400", icon: LogOut },
  ABSENT: { label: "Absent", color: "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400", dot: "bg-rose-500", icon: UserX },
  ON_LEAVE: { label: "On Leave", color: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400", dot: "bg-violet-500", icon: CalendarOff },
  HALF_DAY: { label: "Half Day", color: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", dot: "bg-orange-500", icon: CalendarCheck2 },
  HALF_DAY_LEAVE: { label: "Half Day Leave", color: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400", dot: "bg-violet-500", icon: CalendarOff },
  NOT_CHECKED_IN: { label: "Not Checked In", color: "bg-rose-50/50 text-rose-500 dark:bg-rose-900/15 dark:text-rose-400", dot: "bg-rose-400", icon: CircleDot },
  DAY_OFF: { label: "Day Off", color: "bg-slate-50 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400", dot: "bg-slate-400", icon: CalendarOff },
};

const STATUS_ORDER: Record<string, number> = {
  ON_BREAK: 0, PRESENT: 1, LATE: 2, HALF_DAY: 3,
  NOT_CHECKED_IN: 4, ABSENT: 5, HALF_DAY_LEAVE: 6, ON_LEAVE: 7, CHECKED_OUT: 8, DAY_OFF: 9,
};

// ─── Money helpers ────────────────────────────────────────────────────
// Compact USD formatter for hero numbers; full formatter for tooltips
// and breakdown rows. `masked()` swaps either output for bullet dots
// when the show-money toggle is off.

function emptyMoney(): MoneyBlock {
  return { orders: 0, sale: 0, cost: 0, profit: 0 };
}
function emptyRefund(): RefundBlock {
  return { count: 0, loss: 0, recovered: 0 };
}
function addMoney(a: MoneyBlock, b: MoneyBlock): MoneyBlock {
  return {
    orders: a.orders + b.orders,
    sale: a.sale + b.sale,
    cost: a.cost + b.cost,
    profit: a.profit + b.profit,
  };
}
function addRefunds(a: RefundBlock, b: RefundBlock): RefundBlock {
  return {
    count: a.count + b.count,
    loss: a.loss + b.loss,
    recovered: a.recovered + b.recovered,
  };
}

function compactUsd(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${amount < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${amount < 0 ? "-" : ""}$${Math.round(abs / 1_000)}k`;
  if (abs >= 1_000) return `${amount < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}k`;
  return `${amount < 0 ? "-" : ""}$${abs.toFixed(2)}`;
}

const MONEY_MASK = "•••";
function masked(value: string, show: boolean): string {
  return show ? value : MONEY_MASK;
}

/** Percent change current vs previous, null when previous is 0. */
function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function AdminDashboard({
  totalEmployees,
  presentToday,
  lateToday,
  absentToday,
  totalFines,
  employeeStatuses,
  dayOffLabel,
  attendanceTrend = [],
  finesTrend = [],
  todayReports = 0,
  topAbsent = [],
  teamGroups = [],
  commandCenter,
  userName,
  financials,
  offices = [],
}: AdminDashboardProps) {
  // ─── Office filter ─────────────────────────────────────────────────
  // "all" = combined across both offices; otherwise scope to a single
  // office slug. Used by the office tabs at the top of the financials
  // and team sections.
  const [officeFilter, setOfficeFilter] = useState<string>("all");

  // ─── Money-visibility toggle ───────────────────────────────────────
  // Hides every USD figure on the page (replaces with bullet dots) so
  // the CEO can show the dashboard to others without revealing actual
  // revenue. Off by default — Wasif sees the numbers when he opens it.
  const [showMoney, setShowMoney] = useState<boolean>(true);

  // Filter teamGroups + financials by office. Reused in the existing
  // "Teams" headcount section AND the new financials sections so they
  // stay in sync.
  const scopedTeamGroups = useMemo(() => {
    if (officeFilter === "all") return teamGroups;
    const officeName = offices.find((o) => o.slug === officeFilter)?.name;
    if (!officeName) return teamGroups;
    return teamGroups.filter((t) => t.officeName === officeName);
  }, [teamGroups, officeFilter, offices]);

  const scopedFinancials = useMemo(() => {
    if (!financials) return null;
    if (officeFilter === "all") return financials;
    const perTeam = financials.perTeam.filter((t) => t.officeSlug === officeFilter);
    // Recompute combined for the filtered scope.
    const acc = perTeam.reduce(
      (a, t) => ({
        today: addMoney(a.today, t.today),
        mtd: addMoney(a.mtd, t.mtd),
        lastMonthSameDay: addMoney(a.lastMonthSameDay, t.lastMonthSameDay),
        lastMonthFull: addMoney(a.lastMonthFull, t.lastMonthFull),
        refundsMtd: addRefunds(a.refundsMtd, t.refundsMtd),
        refundsLastMonth: addRefunds(a.refundsLastMonth, t.refundsLastMonth),
      }),
      {
        today: emptyMoney(),
        mtd: emptyMoney(),
        lastMonthSameDay: emptyMoney(),
        lastMonthFull: emptyMoney(),
        refundsMtd: emptyRefund(),
        refundsLastMonth: emptyRefund(),
      },
    );
    return { ...financials, perTeam, combined: acc };
  }, [financials, officeFilter]);
  const router = useRouter();

  // ─────────────────────────────────────────────────────────────────────
  // Derive everything from raw props so the UI is purely a function of
  // server-fetched state. Re-runs free since the props object is replaced
  // wholesale every router.refresh() (the 30s interval below).
  // ─────────────────────────────────────────────────────────────────────
  const onLeaveToday = useMemo(
    () => employeeStatuses.filter((e) => e.liveStatus === "ON_LEAVE" || e.liveStatus === "HALF_DAY_LEAVE").length,
    [employeeStatuses],
  );
  const onBreakNow = useMemo(
    () => employeeStatuses.filter((e) => e.liveStatus === "ON_BREAK").length,
    [employeeStatuses],
  );
  const checkedOutNow = useMemo(
    () => employeeStatuses.filter((e) => e.liveStatus === "CHECKED_OUT").length,
    [employeeStatuses],
  );

  const totalPending = useMemo(
    () => teamGroups.reduce((s, tg) => s + tg.monthPending, 0),
    [teamGroups],
  );
  const totalUnpaid = useMemo(
    () => teamGroups.reduce((s, tg) => s + tg.unpaidCount, 0),
    [teamGroups],
  );
  const totalPaid = useMemo(
    () => teamGroups.reduce((s, tg) => s + tg.paidCount, 0),
    [teamGroups],
  );

  const attendanceRate = totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 0;
  const reportRate = totalEmployees > 0 ? Math.round((todayReports / totalEmployees) * 100) : 0;

  // 7-day slice for the fines KPI sparkline. Falls back to whatever we
  // have if the month is younger than 7 days — Recharts handles 1-2 points
  // fine, just renders a flat line.
  const last7Fines = finesTrend.slice(-7);

  // PKT clock — kept in state so React's purity rule is happy and so the
  // greeting transitions correctly across the morning→afternoon→evening
  // boundaries even if the dashboard stays open all day. Lazy initializer
  // so the first paint already has the right time.
  const [pktNow, setPktNow] = useState<Date>(
    () => new Date(Date.now() + 5 * 60 * 60_000),
  );
  useEffect(() => {
    const tick = () => setPktNow(new Date(Date.now() + 5 * 60 * 60_000));
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, []);
  const pktHour = pktNow.getUTCHours();
  const greeting =
    pktHour < 5 ? "Working late" :
    pktHour < 12 ? "Good morning" :
    pktHour < 17 ? "Good afternoon" :
    "Good evening";

  // Donut breakdown for the "Live attendance" chart. Filtered so empty
  // segments don't render as zero-width slivers.
  const attendanceBreakdown = useMemo(
    () =>
      [
        { name: "Present", value: presentToday - lateToday, color: "#10b981" },
        { name: "Late", value: lateToday, color: "#f59e0b" },
        { name: "Absent", value: absentToday, color: "#f43f5e" },
        { name: "On leave", value: onLeaveToday, color: "#a855f7" },
      ].filter((d) => d.value > 0),
    [presentToday, lateToday, absentToday, onLeaveToday],
  );

  // Recent activity feed — last 5 employees who checked in today, sorted
  // newest first. Adds a "live" pulse to the sidebar without needing any
  // extra data fetch.
  const recentCheckIns = useMemo(() => {
    return employeeStatuses
      .filter((e) => e.checkIn)
      .sort((a, b) => new Date(b.checkIn!).getTime() - new Date(a.checkIn!).getTime())
      .slice(0, 5);
  }, [employeeStatuses]);

  // Live updates — reload server-rendered data every 30s. Permanent
  // requirement per Wasif: new hires, new check-ins, etc. surface without
  // a manual refresh.
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(interval);
  }, [router]);

  // Roster expand/collapse state. Each team card has a "Show roster" toggle;
  // expanding one team doesn't affect others. Collapsed by default to keep
  // the page short; the per-team summary is enough for the at-a-glance view.
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(() => new Set());
  const toggleTeam = (key: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Index employee statuses by `teamName|officeName` so each team card can
  // pull its own roster cheaply. Composite key disambiguates same-named
  // teams across offices (e.g. Facebook - HQ vs Facebook - O2).
  const sortedEmployees = [...employeeStatuses].sort(
    (a, b) => (STATUS_ORDER[a.liveStatus] ?? 9) - (STATUS_ORDER[b.liveStatus] ?? 9),
  );
  const rostersByTeamKey = new Map<string, EmployeeStatus[]>();
  for (const emp of sortedEmployees) {
    const k = `${emp.teamName ?? "Unassigned"}|${emp.officeName ?? ""}`;
    const arr = rostersByTeamKey.get(k) ?? [];
    arr.push(emp);
    rostersByTeamKey.set(k, arr);
  }
  const rosterFor = (tg: TeamGroup) =>
    rostersByTeamKey.get(`${tg.name}|${tg.officeName}`) ?? [];

  return (
    <div className="space-y-6">
      {/* ═══════════════════════ HERO HEADER ═══════════════════════ */}
      {/* Personal greeting + date subtitle + live indicator. The gradient
          name accent and refined typography set the boss-level tone — this
          is the first thing the CEO sees every morning. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80 mb-2">
            {formatPKTDisplay(pktNow, "EEEE")} <span className="opacity-40 mx-1">·</span> {formatPKTDisplay(pktNow, "MMMM d, yyyy")}
          </p>
          <h1 className="text-3xl sm:text-[2rem] font-bold tracking-tight leading-tight">
            {greeting}
            {userName ? (
              <>
                ,{" "}
                <span className="bg-gradient-to-br from-foreground via-foreground to-foreground/50 bg-clip-text text-transparent">
                  {userName}
                </span>
              </>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-xl">
            Here&apos;s how META7MEDIA is performing today.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {dayOffLabel && (
            <Badge className="h-7 bg-muted text-muted-foreground border-0 font-medium px-2.5">
              <CalendarOff className="size-3 mr-1.5" />
              {dayOffLabel}
            </Badge>
          )}
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-[11px] shadow-xs">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="font-semibold">Live</span>
            <span className="text-muted-foreground">· syncs every 30s</span>
          </div>
        </div>
      </header>

      {/* ═══════════════════ CONTROL BAR ═══════════════════ */}
      {/* Office filter + value-visibility toggle. Office tabs scope every
          financial section + team list to a single office (or "All").
          Show/hide swaps every USD figure for bullet dots so the CEO can
          screen-share the dashboard without revealing revenue numbers. */}
      {(offices.length > 1 || financials) && (
        <DashboardControls
          offices={offices}
          officeFilter={officeFilter}
          onOfficeChange={setOfficeFilter}
          showMoney={showMoney}
          onToggleMoney={() => setShowMoney((v) => !v)}
        />
      )}

      {/* ════════════════ FINANCIAL HERO STRIP ════════════════ */}
      {/* The CEO's #1 question — "how much money did we make?" — surfaced
          before anything else. Four hero tiles: today's profit, MTD sale,
          MTD gross profit, MTD orders. Each carries a MoM delta against
          the same-day slice of last month for a fair comparison. */}
      {scopedFinancials && (
        <FinancialKpiStrip
          financials={scopedFinancials}
          showMoney={showMoney}
          onRefundsClick={() => router.push("/refunds")}
        />
      )}

      {/* ═══════════════════════ KPI HERO STRIP ═══════════════════════ */}
      {/* Five hero metrics — the at-a-glance read. Each tile is calibrated
          to one job: a single big number, an optional progress bar OR
          sparkline, and a tight subtitle. Mixing those three signal types
          would feel busy, so each tile picks one. */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiTile
          label="Headcount"
          value={totalEmployees.toString()}
          icon={Users}
          tone="slate"
          subtitle={`${teamGroups.length} ${teamGroups.length === 1 ? "team" : "teams"} active`}
        />
        <KpiTile
          label="Present today"
          value={presentToday.toString()}
          suffix={`/ ${totalEmployees}`}
          icon={UserCheck}
          tone="emerald"
          progress={attendanceRate}
          subtitle={`${attendanceRate}% attendance`}
        />
        <KpiTile
          label="Reports filed"
          value={todayReports.toString()}
          suffix={`/ ${totalEmployees}`}
          icon={FileText}
          tone="violet"
          progress={reportRate}
          subtitle={`${reportRate}% submitted`}
        />
        <KpiTile
          label="Pending payroll"
          value={`PKR ${formatCompact(totalPending)}`}
          icon={Wallet}
          tone="amber"
          subtitle={
            totalUnpaid > 0
              ? `${totalUnpaid} unpaid · ${totalPaid} cleared`
              : "All cleared this month"
          }
          onClick={() => router.push("/payroll")}
          accent={totalUnpaid === 0 ? "success" : undefined}
        />
        <KpiTile
          label="Fines this month"
          value={`PKR ${formatCompact(totalFines)}`}
          icon={AlertTriangle}
          tone="rose"
          sparkData={last7Fines.length > 0 ? last7Fines : undefined}
          sparkKey="fines"
          subtitle="Last 7 days"
          onClick={() => router.push("/fines")}
        />
      </section>

      {/* ════════════════════ NEEDS YOUR ATTENTION ════════════════════ */}
      {commandCenter && <CommandPanel counts={commandCenter} onNavigate={router.push} />}

      {/* ═══════════════════ LIVE PULSE + TREND ═══════════════════ */}
      {/* The "right now" snapshot. The donut anchors today's status; the
          larger area chart on the right shows how this month is trending
          so the CEO can spot drift without scrolling. */}
      <section className="grid lg:grid-cols-3 gap-4">
        <Card className="border shadow-none lg:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="size-4 text-muted-foreground" />
                Live attendance
              </CardTitle>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                Now
              </span>
            </div>
          </CardHeader>
          <CardContent className="pb-5">
            <div className="relative h-[180px] w-full">
              {attendanceBreakdown.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={attendanceBreakdown}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={76}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {attendanceBreakdown.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          fontSize: 11,
                          borderRadius: 8,
                          border: "1px solid hsl(var(--border))",
                          backgroundColor: "hsl(var(--background))",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                        }}
                        formatter={(v: any, name: any) => [`${v} ${v === 1 ? "person" : "people"}`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-3xl font-bold tabular-nums tracking-tight">{attendanceRate}%</div>
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5">
                      Attendance
                    </div>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <CalendarOff className="size-7 text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground">No activity today</p>
                </div>
              )}
            </div>
            <div className="mt-3 space-y-1.5">
              {attendanceBreakdown.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="size-2 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-muted-foreground truncate">{d.name}</span>
                  </div>
                  <span className="font-semibold tabular-nums">{d.value}</span>
                </div>
              ))}
              {(onBreakNow > 0 || checkedOutNow > 0) && (
                <div className="flex items-center justify-between text-[11px] pt-2 mt-2 border-t border-dashed border-muted-foreground/15">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {onBreakNow > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Coffee className="size-3 text-sky-500" />
                        <span className="font-semibold tabular-nums">{onBreakNow}</span> on break
                      </span>
                    )}
                    {checkedOutNow > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <LogOut className="size-3" />
                        <span className="font-semibold tabular-nums">{checkedOutNow}</span> out
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-none lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Attendance trend</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Daily present vs absent · {format(pktNow, "MMMM yyyy")}
                </p>
              </div>
              <div className="flex items-center gap-3 text-[10px] shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground font-medium">Present</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-rose-500" />
                  <span className="text-muted-foreground font-medium">Absent</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={attendanceTrend} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="presentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="absentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
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
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--background))",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                    }}
                    cursor={{ stroke: "hsl(var(--muted))", strokeDasharray: "3 3" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="present"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#presentGrad)"
                    name="Present"
                  />
                  <Area
                    type="monotone"
                    dataKey="absent"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    fill="url(#absentGrad)"
                    name="Absent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ════════════════════════ TEAMS GRID ════════════════════════ */}
      {scopedTeamGroups.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Teams</h2>
              <Badge variant="outline" className="text-[10px] font-normal h-5 px-1.5">
                {scopedTeamGroups.length}
              </Badge>
            </div>
            {totalPending > 0 && (
              <button
                type="button"
                onClick={() => router.push("/payroll")}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 group"
              >
                <Wallet className="size-3" />
                <span>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    PKR {Math.round(totalPending).toLocaleString()}
                  </span>
                  {" "}pending across {scopedTeamGroups.length} {scopedTeamGroups.length === 1 ? "team" : "teams"}
                </span>
                <ArrowRight className="size-3 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </button>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {scopedTeamGroups.map((tg) => (
              <TeamCard
                key={tg.key}
                tg={tg}
                roster={rosterFor(tg)}
                expanded={expandedTeams.has(tg.key)}
                onToggle={() => toggleTeam(tg.key)}
                onPayrollClick={() => router.push("/payroll")}
              />
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════════ REVENUE TREND + REFUNDS PULSE ═══════════════════ */}
      {/* Two-column: 30-day revenue trend on the left (so the CEO sees
          whether the month is climbing or sliding), refunds pulse on the
          right (combined office-wide loss + per-team mini-bars + recovery
          rate). Both read from the financials prop — skip rendering
          when no snapshots exist yet (first deploy / pre-cron). */}
      {scopedFinancials && (
        <section className="grid gap-4 lg:grid-cols-3">
          <RevenueTrendCard
            dailySeries={scopedFinancials.dailySeries}
            showMoney={showMoney}
          />
          <RefundsPulseCard
            financials={scopedFinancials}
            showMoney={showMoney}
            onClick={() => router.push("/refunds")}
          />
        </section>
      )}

      {/* ═══════════════════ FINES + ABSENCES + ACTIVITY ═══════════════════ */}
      {/* Bottom row — operational signals: where money moved (fines), who's
          most absent, and the most-recent check-in feed for a "live pulse"
          texture in the corner. */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="border shadow-none lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Fines collected</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Daily fines · PKR · {format(pktNow, "MMMM yyyy")}
                </p>
              </div>
              <div className="text-right">
                <div className="text-base font-bold tabular-nums">
                  PKR {Math.round(totalFines).toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">Month total</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={finesTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="finesBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.5} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--background))",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                    }}
                    formatter={(value: any) => [`PKR ${value}`, "Fines"]}
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                  />
                  <Bar dataKey="fines" fill="url(#finesBarGrad)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {topAbsent.length > 0 && (
            <Card className="border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingDown className="size-4 text-rose-500" />
                  Most absences
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  Top 5 this month
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                <ol className="space-y-2.5">
                  {topAbsent.slice(0, 5).map((emp, i) => (
                    <li
                      key={emp.employeeId}
                      className="flex items-center justify-between gap-2 group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-[10px] font-bold text-muted-foreground/50 tabular-nums w-4 shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-xs font-medium truncate">{emp.name}</span>
                        <span className="text-[9px] text-muted-foreground font-mono shrink-0 opacity-60">
                          {emp.employeeId}
                        </span>
                      </div>
                      <Badge className="text-[10px] h-5 bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400 border-0 shrink-0 tabular-nums font-semibold">
                        {emp.count}d
                      </Badge>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {recentCheckIns.length > 0 && (
            <Card className="border shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="size-4 text-emerald-500" />
                    Recent activity
                  </CardTitle>
                  <span className="text-[10px] text-muted-foreground">Today</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {recentCheckIns.map((emp) => {
                  const config = STATUS_CONFIG[emp.liveStatus] || STATUS_CONFIG.PRESENT;
                  return (
                    <div key={emp.id} className="flex items-center gap-2.5">
                      <div className="relative shrink-0">
                        <div className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
                          {emp.firstName[0]}
                          {emp.lastName?.[0] || ""}
                        </div>
                        <div
                          className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-background ${config.dot}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate leading-tight">
                          {emp.firstName} {emp.lastName || ""}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {emp.liveStatus === "CHECKED_OUT" && emp.checkOut
                            ? `Out ${formatPKTTime(emp.checkOut)}`
                            : emp.checkIn
                            ? `In ${formatPKTTime(emp.checkIn)}`
                            : config.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}

// ─────────────────────── Sub-components ───────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
}

/**
 * KPI tile — one big number, one signal, one tone.
 *
 * Tones map a label color to: icon background, icon text, sparkline stroke,
 * and progress bar fill. Pick exactly one of `progress` or `sparkData` per
 * tile — both at once would visually compete for the bottom slot. The
 * `accent="success"` flag is used when the metric is in a "good" terminal
 * state (e.g. all salaries cleared) so the subtitle gets an emerald check.
 */
function KpiTile({
  label,
  value,
  suffix,
  icon: Icon,
  tone,
  sparkData,
  sparkKey,
  subtitle,
  progress,
  onClick,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: any;
  tone: "slate" | "emerald" | "amber" | "rose" | "violet";
  sparkData?: any[];
  sparkKey?: string;
  subtitle?: string;
  progress?: number;
  onClick?: () => void;
  accent?: "success";
}) {
  const tones = {
    slate: { iconBg: "bg-slate-100 dark:bg-slate-800/60", iconText: "text-slate-700 dark:text-slate-300", spark: "#64748b", bar: "bg-slate-500" },
    emerald: { iconBg: "bg-emerald-50 dark:bg-emerald-950/40", iconText: "text-emerald-600 dark:text-emerald-400", spark: "#10b981", bar: "bg-emerald-500" },
    amber: { iconBg: "bg-amber-50 dark:bg-amber-950/40", iconText: "text-amber-600 dark:text-amber-400", spark: "#f59e0b", bar: "bg-amber-500" },
    rose: { iconBg: "bg-rose-50 dark:bg-rose-950/40", iconText: "text-rose-600 dark:text-rose-400", spark: "#f43f5e", bar: "bg-rose-500" },
    violet: { iconBg: "bg-violet-50 dark:bg-violet-950/40", iconText: "text-violet-600 dark:text-violet-400", spark: "#a855f7", bar: "bg-violet-500" },
  } as const;
  const t = tones[tone];
  const sparkId = `spark-${sparkKey ?? "none"}-${tone}`;

  const Wrapper: any = onClick ? "button" : "div";
  const wrapperProps: any = onClick ? { onClick, type: "button" } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={`relative overflow-hidden rounded-xl border bg-card p-4 transition-all text-left ${
        onClick
          ? "hover:bg-accent/30 hover:border-foreground/20 hover:shadow-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          : ""
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`size-8 rounded-lg flex items-center justify-center ${t.iconBg}`}>
          <Icon className={`size-3.5 ${t.iconText}`} />
        </div>
        {onClick && (
          <ArrowUpRight className="size-3.5 text-muted-foreground/30 group-hover:text-foreground transition-colors" />
        )}
      </div>
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.12em] mb-1.5">
          {label}
        </p>
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="text-[26px] font-bold tabular-nums tracking-tight leading-none">
            {value}
          </span>
          {suffix && (
            <span className="text-sm text-muted-foreground/70 font-medium tabular-nums">
              {suffix}
            </span>
          )}
        </div>
        {subtitle && (
          <p className={`text-[11px] mt-1 ${accent === "success" ? "text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1" : "text-muted-foreground"}`}>
            {accent === "success" && <CheckCircle2 className="size-3" />}
            {subtitle}
          </p>
        )}
      </div>
      {progress !== undefined && (
        <div className="mt-3.5 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${t.bar}`}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
      {sparkData && sparkKey && (
        <div className="mt-3 -mx-1 h-[28px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={sparkId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.spark} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={t.spark} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey={sparkKey}
                stroke={t.spark}
                strokeWidth={1.5}
                fill={`url(#${sparkId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Wrapper>
  );
}

/**
 * Command Panel — the inbox row. Four queues that the CEO is on the hook
 * for: leaves, login approvals, review bonuses, complaints. Click a tile
 * to jump to that page. Inactive tiles (count = 0) gray out so the eye
 * skips them.
 */
function CommandPanel({
  counts,
  onNavigate,
}: {
  counts: CommandCenterCounts;
  onNavigate: (href: string) => void;
}) {
  const items = [
    { label: "Leave requests", count: counts.pendingLeaves, href: "/leaves", icon: Inbox, accent: "violet" as const },
    { label: "Login approvals", count: counts.pendingDevices, href: "/login-approvals", icon: Smartphone, accent: "blue" as const },
    { label: "Review bonuses", count: counts.pendingReviewBonuses, href: "/review-bonus", icon: Star, accent: "amber" as const },
    { label: "Complaints", count: counts.complaintsAwaitingReply, href: "/complaints", icon: MessageSquare, accent: "rose" as const },
  ];
  const totalPending = items.reduce((s, i) => s + i.count, 0);
  const accentClasses = {
    violet: "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30",
    blue: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30",
    rose: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30",
  } as const;

  return (
    <Card className="border shadow-none overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="size-3.5 text-amber-500" />
              Needs your attention
            </h2>
          </div>
          {totalPending === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              Inbox zero
            </span>
          ) : (
            <span className="text-[11px] font-medium text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{totalPending}</span> open
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.count > 0;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => onNavigate(item.href)}
                className={`group relative text-left rounded-lg border bg-card p-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isActive
                    ? "hover:border-foreground/20 hover:shadow-sm hover:bg-accent/30"
                    : "opacity-50 hover:opacity-80"
                }`}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <div className={`size-7 rounded-md flex items-center justify-center ${accentClasses[item.accent]}`}>
                    <Icon className="size-3.5" />
                  </div>
                  <ArrowRight className="size-3 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl font-bold tabular-nums tracking-tight ${!isActive && "text-muted-foreground"}`}>
                    {item.count}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {item.label}
                </p>
                {isActive && (
                  <div className={`absolute top-3 right-9 size-1.5 rounded-full animate-pulse ${
                    item.accent === "violet" ? "bg-violet-500" :
                    item.accent === "blue" ? "bg-blue-500" :
                    item.accent === "amber" ? "bg-amber-500" :
                    "bg-rose-500"
                  }`} />
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Team card — the workhorse of this page.
 *
 * Header: team name + headcount + partner/office subtitle, with a
 *   right-aligned "in office now" live count.
 * Body: today's split shown as both a segmented progress bar (visual)
 *   and four labeled metrics (precise numbers).
 * Money line: pending salary + monthly fines, both clickable to /payroll.
 * Roster: collapsible list of every member with live status pill.
 */
function TeamCard({
  tg,
  roster,
  expanded,
  onToggle,
  onPayrollClick,
}: {
  tg: TeamGroup;
  roster: EmployeeStatus[];
  expanded: boolean;
  onToggle: () => void;
  onPayrollClick: () => void;
}) {
  // Live count — anyone currently in the office (present, late, or on break).
  const inOfficeNow = roster.filter(
    (e) => e.liveStatus === "PRESENT" || e.liveStatus === "LATE" || e.liveStatus === "ON_BREAK",
  ).length;

  // Segmented bar segments, only including non-zero so width math is clean.
  // Note: presentToday already includes lateToday (partial overlap) — we
  // split them visually here using `presentToday - lateToday` for the
  // "on time" green segment.
  const onTime = Math.max(0, tg.presentToday - tg.lateToday);
  const segments = [
    { color: "bg-emerald-500", value: onTime },
    { color: "bg-amber-500", value: tg.lateToday },
    { color: "bg-rose-500", value: tg.absentToday },
    { color: "bg-violet-500", value: tg.onLeaveToday },
  ].filter((s) => s.value > 0);

  return (
    <Card className="border shadow-none overflow-hidden">
      {/* Header — team identity */}
      <div className="px-4 py-3 border-b bg-gradient-to-br from-muted/20 to-transparent">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold truncate">{tg.name}</h3>
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-normal shrink-0 tabular-nums">
                {tg.memberCount}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {tg.partnerName ? tg.partnerName : "CEO direct"}
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              {tg.officeName}
            </p>
          </div>
          {roster.length > 0 && (
            <div className="text-right shrink-0">
              <div className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                In office now
              </div>
              <div className="text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400 leading-tight mt-0.5">
                {inOfficeNow}
                <span className="text-muted-foreground font-normal text-xs">/{roster.length}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Today's split — segmented bar + inline metrics */}
      <div className="px-4 py-3 space-y-2.5">
        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
          {segments.length > 0 ? (
            segments.map((s, i) => (
              <div
                key={i}
                className={`${s.color} transition-all duration-500`}
                style={{ width: `${(s.value / Math.max(1, tg.memberCount)) * 100}%` }}
              />
            ))
          ) : (
            <div className="w-full bg-muted" />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
          <div className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Present</span>
            <span className="font-semibold tabular-nums">{tg.presentToday}</span>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">Late</span>
            <span className="font-semibold tabular-nums">{tg.lateToday}</span>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-rose-500" />
            <span className="text-muted-foreground">Absent</span>
            <span className="font-semibold tabular-nums">{tg.absentToday}</span>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-violet-500" />
            <span className="text-muted-foreground">Leave</span>
            <span className="font-semibold tabular-nums">{tg.onLeaveToday}</span>
          </div>
        </div>
      </div>

      {/* Money row */}
      <div className="px-4 py-2.5 border-t border-b bg-muted/10 flex items-center justify-between gap-3 text-[11px]">
        {tg.monthPending > 0 ? (
          <button
            type="button"
            onClick={onPayrollClick}
            className="flex items-center gap-1.5 hover:text-amber-700 dark:hover:text-amber-400 transition-colors group"
            title="Open payroll"
          >
            <Wallet className="size-3 text-amber-600 dark:text-amber-400" />
            <span className="text-muted-foreground">Pending</span>
            <span className="font-semibold tabular-nums">PKR {Math.round(tg.monthPending).toLocaleString()}</span>
            <span className="text-[9px] text-muted-foreground tabular-nums">
              ({tg.unpaidCount}/{tg.unpaidCount + tg.paidCount})
            </span>
            <ArrowRight className="size-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3" />
            <span className="text-muted-foreground">Salaries</span>
            <span className="font-semibold">All paid</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">Fines</span>
          <span className="font-semibold tabular-nums">
            PKR {Math.round(tg.monthFines).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Roster toggle */}
      {roster.length > 0 && (
        <>
          <button
            type="button"
            onClick={onToggle}
            className="w-full px-4 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1.5"
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {expanded ? "Hide roster" : `Show ${roster.length} ${roster.length === 1 ? "employee" : "employees"}`}
          </button>

          {expanded && (
            <div className="border-t divide-y divide-muted/30">
              {roster.map((emp) => {
                const config = STATUS_CONFIG[emp.liveStatus] || STATUS_CONFIG.NOT_CHECKED_IN;
                const Icon = config.icon;
                return (
                  <div
                    key={emp.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="relative shrink-0">
                        <div className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-bold">
                          {emp.firstName[0]}
                          {emp.lastName?.[0] || ""}
                        </div>
                        <div
                          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background ${config.dot}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12px] font-semibold truncate">
                            {emp.firstName} {emp.lastName || ""}
                          </span>
                          <span className="text-[9px] text-muted-foreground font-mono bg-muted/60 px-1.5 py-0.5 rounded shrink-0">
                            {emp.employeeId}
                          </span>
                          {emp.empStatus === "PROBATION" && (
                            <Badge className="text-[8px] h-4 px-1.5 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 border-0 shrink-0">
                              PROBATION
                            </Badge>
                          )}
                        </div>
                        {emp.checkIn && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            {formatPKTTime(emp.checkIn)}
                            {emp.checkOut && ` — ${formatPKTTime(emp.checkOut)}`}
                          </p>
                        )}
                      </div>
                    </div>
                    <div
                      className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ${config.color}`}
                    >
                      <Icon className="size-3" />
                      {config.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ─────────────────────────── DashboardControls ───────────────────────────

/**
 * Office filter (segmented tabs) + show/hide money toggle.
 *
 * "All offices" is the default; clicking a slug filters every financial
 * section + the Teams grid to that office only. The eye toggle masks
 * every USD figure on the page with bullet dots so the CEO can present
 * the dashboard without exposing actual revenue.
 */
function DashboardControls({
  offices,
  officeFilter,
  onOfficeChange,
  showMoney,
  onToggleMoney,
}: {
  offices: OfficeOption[];
  officeFilter: string;
  onOfficeChange: (slug: string) => void;
  showMoney: boolean;
  onToggleMoney: () => void;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  // Hits POST /api/dashboard/refresh-financials → rebuilds today's
  // DailyTeamSnapshot rows from the live sheets, then triggers a
  // router.refresh() so the server re-renders with the new data.
  // Sheet reads take 20–40s, so we hold a loading state the whole time.
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard/refresh-financials", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || `Refresh failed (${res.status})`);
        return;
      }
      const body = await res.json();
      const rows = body.snapshot?.rowsUpserted ?? 0;
      toast.success(
        rows > 0
          ? `Refreshed · ${rows} day-team rows updated from live sheets`
          : "Refreshed",
      );
      setLastRefreshedAt(new Date());
      // Re-render the dashboard server-side. Reads back the fresh
      // snapshot rows we just wrote.
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const tabs = [{ slug: "all", name: "All offices", isPrimary: false }, ...offices];
  return (
    <Card className="border shadow-none">
      <CardContent className="py-2.5 px-3 sm:px-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          {/* Office tabs */}
          <div className="inline-flex rounded-lg border bg-card p-1 gap-1 w-full sm:w-auto overflow-x-auto">
            {tabs.map((t) => {
              const isActive = officeFilter === t.slug;
              return (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => onOfficeChange(t.slug)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-pressed={isActive}
                >
                  {t.slug === "all" ? (
                    <Building2 className="size-3.5" />
                  ) : (
                    <Briefcase className="size-3.5" />
                  )}
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {lastRefreshedAt && !refreshing && (
              <span className="hidden md:inline text-[10px] text-muted-foreground/70 tabular-nums">
                Last refreshed{" "}
                {lastRefreshedAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}

            {/* Refresh now — re-pulls live sheets + rebuilds snapshots. */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground rounded-md border bg-card px-3 py-1.5 transition-colors shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Re-pull live sheet data and rebuild today's numbers (~30s)"
            >
              <RefreshCcw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              <span>{refreshing ? "Refreshing…" : "Refresh now"}</span>
            </button>

            {/* Show/hide money */}
            <button
              type="button"
              onClick={onToggleMoney}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground rounded-md border bg-card px-3 py-1.5 transition-colors shrink-0"
              aria-pressed={!showMoney}
              title={showMoney ? "Hide all $ figures" : "Show all $ figures"}
            >
              {showMoney ? (
                <>
                  <EyeOff className="size-3.5" />
                  <span>Hide values</span>
                </>
              ) : (
                <>
                  <Eye className="size-3.5" />
                  <span>Show values</span>
                </>
              )}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── FinancialKpiStrip ───────────────────────────

/**
 * Four hero tiles answering the CEO's most-asked question:
 * "how much money did we make?"
 *
 *   • Today's Profit        — green, with delta vs same day last month
 *   • MTD Sales             — total revenue this month + MoM delta
 *   • MTD Gross Profit      — sale minus cost + MoM delta
 *   • Refunds MTD           — count + USD lost · clickable to /refunds
 */
function FinancialKpiStrip({
  financials,
  showMoney,
  onRefundsClick,
}: {
  financials: DashboardFinancials;
  showMoney: boolean;
  onRefundsClick: () => void;
}) {
  const { today, mtd, lastMonthSameDay, refundsMtd, refundsLastMonth } =
    financials.combined;

  const todayProfitDelta = pctDelta(today.profit, lastMonthSameDayOneDay(financials));
  const mtdSaleDelta = pctDelta(mtd.sale, lastMonthSameDay.sale);
  const mtdProfitDelta = pctDelta(mtd.profit, lastMonthSameDay.profit);
  const refundsDelta = pctDelta(refundsMtd.loss, refundsLastMonth.loss);

  // Recovery rate — what % of refund losses we clawed back from AliExpress.
  const recoveryRate =
    refundsMtd.loss > 0 ? (refundsMtd.recovered / refundsMtd.loss) * 100 : null;

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <FinancialTile
        label="Today's Profit"
        value={masked(compactUsd(today.profit), showMoney)}
        subtitle={`${today.orders} ${today.orders === 1 ? "order" : "orders"} · ${
          masked(compactUsd(today.sale), showMoney)
        } sale`}
        icon={TrendingUp}
        tone="emerald"
        accent="primary"
        delta={todayProfitDelta}
        deltaLabel="vs same day last month"
      />
      <FinancialTile
        label="MTD Sales"
        value={masked(compactUsd(mtd.sale), showMoney)}
        subtitle={`${mtd.orders.toLocaleString()} orders this month`}
        icon={ShoppingCart}
        tone="slate"
        delta={mtdSaleDelta}
        deltaLabel="vs last month MTD"
      />
      <FinancialTile
        label="MTD Gross Profit"
        value={masked(compactUsd(mtd.profit), showMoney)}
        subtitle={
          mtd.sale > 0
            ? `${((mtd.profit / mtd.sale) * 100).toFixed(0)}% margin`
            : "—"
        }
        icon={DollarSign}
        tone="violet"
        delta={mtdProfitDelta}
        deltaLabel="vs last month MTD"
      />
      <FinancialTile
        label="Refunds MTD"
        value={masked(`-${compactUsd(refundsMtd.loss)}`, showMoney)}
        subtitle={
          refundsMtd.count === 0
            ? "No refunds this month"
            : `${refundsMtd.count} refunds · ${
                recoveryRate != null ? `${recoveryRate.toFixed(0)}% recovered` : "no recovery yet"
              }`
        }
        icon={Receipt}
        tone="rose"
        delta={refundsDelta != null ? -refundsDelta : null}
        deltaLabel="vs last month — lower is better"
        deltaInverse
        onClick={onRefundsClick}
      />
    </section>
  );
}

/** Pull today's profit from yesterday-of-last-month for the delta calc.
 *  Falls back to lastMonthSameDay.profit / dayOfMonth when we can't isolate
 *  the specific day (e.g. before backfill catches up). Good enough. */
function lastMonthSameDayOneDay(f: DashboardFinancials): number {
  const lastMonthSameDayProfit = f.combined.lastMonthSameDay.profit;
  // Number of days summed in lastMonthSameDay = dayOfMonth (today's date number).
  // We approximate same-day-last-month by averaging.
  const todayIso = f.todayISO;
  const day = parseInt(todayIso.split("-")[2] ?? "1", 10);
  if (day <= 0) return 0;
  return lastMonthSameDayProfit / day;
}

/**
 * Single financial KPI tile — similar to KpiTile but with a delta pill.
 * `accent="primary"` adds a subtle ring so the Today's Profit headline
 * stands out among the row.
 */
function FinancialTile({
  label,
  value,
  subtitle,
  icon: Icon,
  tone,
  accent,
  delta,
  deltaLabel,
  deltaInverse,
  onClick,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: any;
  tone: "emerald" | "slate" | "violet" | "rose" | "amber";
  accent?: "primary";
  delta?: number | null;
  deltaLabel?: string;
  deltaInverse?: boolean;
  onClick?: () => void;
}) {
  const tones = {
    emerald: { iconBg: "bg-emerald-50 dark:bg-emerald-950/40", iconText: "text-emerald-600 dark:text-emerald-400", primary: "text-emerald-700 dark:text-emerald-400" },
    slate: { iconBg: "bg-slate-100 dark:bg-slate-800/60", iconText: "text-slate-700 dark:text-slate-300", primary: "" },
    violet: { iconBg: "bg-violet-50 dark:bg-violet-950/40", iconText: "text-violet-600 dark:text-violet-400", primary: "" },
    rose: { iconBg: "bg-rose-50 dark:bg-rose-950/40", iconText: "text-rose-600 dark:text-rose-400", primary: "" },
    amber: { iconBg: "bg-amber-50 dark:bg-amber-950/40", iconText: "text-amber-600 dark:text-amber-400", primary: "" },
  } as const;
  const t = tones[tone];
  const isPrimary = accent === "primary";

  // Delta direction — positive in green, negative in rose, unless inverse
  // (e.g. refunds: lower is better, so a NEGATIVE delta is good).
  const positive = (delta ?? 0) >= 0;
  const goodDirection = deltaInverse ? positive : positive;

  const Wrapper: any = onClick ? "button" : "div";
  const wrapperProps: any = onClick ? { onClick, type: "button" } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={`relative overflow-hidden rounded-xl border bg-card p-4 transition-all text-left ${
        onClick ? "hover:bg-accent/30 hover:border-foreground/20 cursor-pointer" : ""
      } ${isPrimary ? "ring-1 ring-emerald-500/20 dark:ring-emerald-400/20" : ""}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`size-8 rounded-lg flex items-center justify-center ${t.iconBg}`}>
          <Icon className={`size-3.5 ${t.iconText}`} />
        </div>
        {delta != null && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full ${
              goodDirection
                ? "bg-emerald-100/60 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-rose-100/60 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
            }`}
            title={deltaLabel}
          >
            {goodDirection ? "↑" : "↓"} {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[0.12em] mb-1.5">
        {label}
      </p>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className={`text-[26px] font-bold tabular-nums tracking-tight leading-none ${t.primary}`}>
          {value}
        </span>
      </div>
      {subtitle && (
        <p className="text-[11px] text-muted-foreground mt-1 truncate">{subtitle}</p>
      )}
    </Wrapper>
  );
}

// ─────────────────────────── RevenueTrendCard ───────────────────────────

/**
 * 30-day revenue trend — area chart of daily sales with profit overlay.
 * Anchors the eye in the "trends" row alongside the refunds pulse.
 * Falls back to a friendly empty state when there's no snapshot data yet
 * (e.g. fresh deploy, before the first cron run).
 */
function RevenueTrendCard({
  dailySeries,
  showMoney,
}: {
  dailySeries: { date: string; sale: number; profit: number; orders: number }[];
  showMoney: boolean;
}) {
  const hasData = dailySeries.some((d) => d.sale > 0);

  // Strip year off the date label so x-axis stays compact (Jan 12 / Jan 13).
  const data = dailySeries.map((d) => {
    const [, m, day] = d.date.split("-");
    return { ...d, label: `${day}/${m}` };
  });

  return (
    <Card className="border shadow-none lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Revenue trend</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Daily sale (and profit) · last 30 days
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-slate-500" />
              <span className="text-muted-foreground font-medium">Sale</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground font-medium">Profit</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-[220px] w-full">
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revSaleGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#64748b" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#64748b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="revProfitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => showMoney ? compactUsd(v) : "•"} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--background))", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}
                  cursor={{ stroke: "hsl(var(--muted))", strokeDasharray: "3 3" }}
                  formatter={(v: any, name: any) => [showMoney ? `$${(v as number).toFixed(2)}` : MONEY_MASK, name]}
                />
                <Area type="monotone" dataKey="sale" stroke="#64748b" strokeWidth={1.5} fill="url(#revSaleGrad)" name="Sale" />
                <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fill="url(#revProfitGrad)" name="Profit" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <PackageOpen className="size-7 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No revenue data yet.</p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                The daily cron populates this at 9am PKT.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── RefundsPulseCard ───────────────────────────

/**
 * Refunds context — total $ lost this month, recovery rate from
 * AliExpress, per-team breakdown bars, and a click-through to /refunds.
 *
 * Reads from financials.combined.refundsMtd + financials.perTeam[].refundsMtd.
 */
function RefundsPulseCard({
  financials,
  showMoney,
  onClick,
}: {
  financials: DashboardFinancials;
  showMoney: boolean;
  onClick: () => void;
}) {
  const { refundsMtd } = financials.combined;
  const recoveryRate = refundsMtd.loss > 0 ? (refundsMtd.recovered / refundsMtd.loss) * 100 : 0;
  const netLoss = refundsMtd.loss - refundsMtd.recovered;

  // Per-team mini-bars — only Etsy teams have refunds (FB doesn't track).
  const perTeam = financials.perTeam
    .filter((t) => t.teamKey === "em" || t.teamKey === "ae" || t.teamKey === "me")
    .map((t) => ({
      teamKey: t.teamKey,
      teamName: t.teamName ?? labelForTeamKey(t.teamKey),
      count: t.refundsMtd.count,
      loss: t.refundsMtd.loss,
    }));
  const maxLoss = Math.max(1, ...perTeam.map((t) => t.loss));

  return (
    <Card className="border shadow-none lg:col-span-1 group transition-colors cursor-pointer hover:bg-accent/10">
      <div onClick={onClick} className="contents">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Receipt className="size-4 text-rose-500" />
              Refunds pulse
            </CardTitle>
            <ArrowRight className="size-3.5 text-muted-foreground/60 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">This month</p>
        </CardHeader>
        <CardContent className="pb-4">
          {refundsMtd.count === 0 ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="size-7 text-emerald-500/60 mx-auto mb-2" />
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                No refunds yet
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Clean slate this month.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <div className="text-[26px] font-bold tabular-nums tracking-tight leading-none text-rose-700 dark:text-rose-400">
                  -{masked(compactUsd(netLoss), showMoney)}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Net loss · {refundsMtd.count} refund{refundsMtd.count !== 1 ? "s" : ""} ·{" "}
                  <span className="font-semibold text-foreground/80">
                    {recoveryRate.toFixed(0)}%
                  </span>{" "}
                  recovered from AliExpress
                </p>
              </div>
              <div className="space-y-2">
                {perTeam.map((t) => (
                  <div key={t.teamKey} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{t.teamName}</span>
                      <span className="tabular-nums">
                        {t.count} · {masked(compactUsd(t.loss), showMoney)}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-rose-400 rounded-full transition-all"
                        style={{ width: `${(t.loss / maxLoss) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                {perTeam.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    No team-level breakdown available.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </div>
    </Card>
  );
}

function labelForTeamKey(k: string): string {
  if (k === "em") return "Izaan (EM)";
  if (k === "ae") return "Awais (AE)";
  if (k === "me") return "Mubeen (ME)";
  if (k === "fb-hq") return "Facebook HQ";
  if (k === "fb-o2") return "Facebook O2";
  return k;
}
