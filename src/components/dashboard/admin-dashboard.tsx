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
} from "lucide-react";
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
}: AdminDashboardProps) {
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
      {teamGroups.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Teams</h2>
              <Badge variant="outline" className="text-[10px] font-normal h-5 px-1.5">
                {teamGroups.length}
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
                  {" "}pending across {teamGroups.length} teams
                </span>
                <ArrowRight className="size-3 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </button>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {teamGroups.map((tg) => (
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
