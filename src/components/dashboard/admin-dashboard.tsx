"use client";

import { useEffect, useState } from "react";
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
  ChevronDown,
  ChevronUp,
  TrendingDown,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { formatPKTDisplay, formatPKTTime } from "@/lib/pkt";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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
}: AdminDashboardProps) {
  const router = useRouter();
  const attendanceRate = totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 0;
  const reportRate = totalEmployees > 0 ? Math.round((todayReports / totalEmployees) * 100) : 0;

  // Live updates — reload the server-rendered data every 30s. Permanent
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

  // Combined pending salary across all teams — shown small in the Teams
  // section header. Per-team breakdown surfaces in each team card.
  const totalPending = teamGroups.reduce((s, tg) => s + tg.monthPending, 0);

  return (
    <div className="space-y-6">
      {/* ═══════════════════════ Header ═══════════════════════ */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatPKTDisplay(new Date(Date.now() + 5 * 60 * 60_000), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {dayOffLabel && (
            <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-0">
              {dayOffLabel}
            </Badge>
          )}
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live · auto-refreshes every 30s
          </span>
        </div>
      </header>

      {/* ════════════════ Needs your attention ════════════════ */}
      {commandCenter && <CommandCenter counts={commandCenter} onNavigate={router.push} />}

      {/* ════════════════════════ Today ════════════════════════ */}
      {/* Headcount-only metrics for the company today. Money stays out of
          here on purpose (per Wasif's "no aggregates" rule for salaries)
          — per-team money lives inside each team card below. */}
      <Card className="border shadow-none">
        <CardContent className="py-4 px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <h2 className="text-base font-semibold">Today</h2>
              <Metric icon={UserCheck} value={presentToday} suffix={`/ ${totalEmployees}`} label="present" tone="emerald" />
              <Metric icon={Clock} value={lateToday} label="late" tone="amber" />
              <Metric icon={UserX} value={absentToday} label="absent" tone="rose" />
              <Metric icon={FileText} value={todayReports} suffix={`/ ${totalEmployees}`} label="reports submitted" tone="violet" />
            </div>
            {!dayOffLabel && (
              <div className="flex items-center gap-2 lg:min-w-[200px]">
                <span className="text-xs text-muted-foreground shrink-0">Attendance</span>
                <div className="h-1.5 flex-1 lg:w-32 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      attendanceRate >= 80 ? "bg-emerald-500" : attendanceRate >= 50 ? "bg-amber-500" : "bg-rose-500"
                    }`}
                    style={{ width: `${attendanceRate}%` }}
                  />
                </div>
                <span
                  className={`text-xs font-bold tabular-nums shrink-0 ${
                    attendanceRate >= 80 ? "text-emerald-600" : attendanceRate >= 50 ? "text-amber-600" : "text-rose-600"
                  }`}
                >
                  {attendanceRate}%
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ════════════════════════ Teams ════════════════════════ */}
      {/* The main work surface — one card per team, each carrying its own
          today's stats, money lines, and (collapsible) live roster. Replaces
          the old Salaries Pending / Teams Overview / Live Status trio. */}
      {teamGroups.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">Teams</h2>
              <Badge variant="outline" className="text-[10px] font-normal">
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
                  <span className="font-semibold text-amber-700 dark:text-amber-400">PKR {Math.round(totalPending).toLocaleString()}</span> pending
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

      {/* ════════════════════════ Trends ════════════════════════ */}
      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Attendance Trend</CardTitle>
            <p className="text-[11px] text-muted-foreground">Daily present vs absent · {format(new Date(), "MMM yyyy")}</p>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={attendanceTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="presentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="absentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" opacity={0.5} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                  <Area type="monotone" dataKey="present" stroke="#10b981" strokeWidth={2} fill="url(#presentGrad)" name="Present" />
                  <Area type="monotone" dataKey="absent" stroke="#f43f5e" strokeWidth={2} fill="url(#absentGrad)" name="Absent" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Fines Collected</CardTitle>
            <p className="text-[11px] text-muted-foreground">Daily fines · PKR · {format(new Date(), "MMM yyyy")}</p>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={finesTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" opacity={0.5} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} formatter={(value: any) => [`PKR ${value}`, "Fines"]} />
                  <Bar dataKey="fines" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Fines" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ═══════════════════════ Most Absences ═══════════════════════ */}
      {topAbsent.length > 0 && (
        <Card className="border shadow-none">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingDown className="size-4 text-rose-500" />
                  Most Absences
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">Top 5 employees this month</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {topAbsent.map((emp, i) => (
                <li key={emp.employeeId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[11px] font-bold text-muted-foreground w-5 tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-medium truncate">{emp.name}</span>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">{emp.employeeId}</span>
                  </div>
                  <Badge className="text-[10px] h-5 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-0 shrink-0">
                    {emp.count} day{emp.count !== 1 ? "s" : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────── Sub-components ───────────────────────

function Metric({
  icon: Icon,
  value,
  suffix,
  label,
  tone,
}: {
  icon: any;
  value: number;
  suffix?: string;
  label: string;
  tone: "emerald" | "amber" | "rose" | "violet";
}) {
  const toneClasses = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
    violet: "text-violet-600 dark:text-violet-400",
  } as const;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <Icon className={`size-4 ${toneClasses[tone]}`} />
      <span className="font-bold tabular-nums">{value}</span>
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function CommandCenter({
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
    <Card className="border shadow-none">
      <CardContent className="py-4 px-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Needs your attention</h2>
          {totalPending === 0 ? (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              Inbox zero ✦
            </span>
          ) : (
            <span className="text-[11px] font-medium text-muted-foreground">
              {totalPending} pending
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.count > 0;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => onNavigate(item.href)}
                className={`group text-left rounded-lg border bg-card px-3 py-3 hover:border-foreground/20 hover:shadow-sm transition-all ${
                  !isActive && "opacity-60 hover:opacity-90"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className={`size-7 rounded-md flex items-center justify-center ${accentClasses[item.accent]}`}>
                    <Icon className="size-3.5" />
                  </div>
                  <ArrowRight className="size-3 text-muted-foreground/60 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-xl font-bold tabular-nums ${!isActive && "text-muted-foreground"}`}>
                    {item.count}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.label}</p>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

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
  const presentRate = tg.memberCount > 0 ? Math.round((tg.presentToday / tg.memberCount) * 100) : 0;
  const presentLikeNow = roster.filter(
    (e) => e.liveStatus === "PRESENT" || e.liveStatus === "LATE" || e.liveStatus === "ON_BREAK",
  ).length;

  return (
    <Card className="border shadow-none overflow-hidden">
      {/* Card header — team identity */}
      <div className="px-4 py-3 border-b bg-muted/15">
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
              <div className="text-[10px] text-muted-foreground">In office now</div>
              <div className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {presentLikeNow}<span className="text-muted-foreground font-normal">/{roster.length}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Today's roster split */}
      <div className="px-4 py-3 grid grid-cols-4 gap-2">
        <StatPill label="Present" value={tg.presentToday} tone="emerald" />
        <StatPill label="Late" value={tg.lateToday} tone="amber" />
        <StatPill label="Absent" value={tg.absentToday} tone="rose" />
        <StatPill label="Leave" value={tg.onLeaveToday} tone="violet" />
      </div>

      {/* Attendance bar */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span>Attendance today</span>
          <span className="font-semibold tabular-nums">{presentRate}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              presentRate >= 80 ? "bg-emerald-500" : presentRate >= 60 ? "bg-amber-500" : "bg-rose-500"
            }`}
            style={{ width: `${Math.min(100, presentRate)}%` }}
          />
        </div>
      </div>

      {/* Money row — pending salary + monthly fines */}
      <div className="px-4 py-2.5 border-t border-b bg-muted/10 flex items-center justify-between gap-3 text-[11px]">
        {tg.monthPending > 0 ? (
          <button
            type="button"
            onClick={onPayrollClick}
            className="flex items-center gap-1.5 hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
            title="Open payroll"
          >
            <Wallet className="size-3 text-amber-600 dark:text-amber-400" />
            <span className="text-muted-foreground">Pending</span>
            <span className="font-semibold tabular-nums">PKR {Math.round(tg.monthPending).toLocaleString()}</span>
            <span className="text-[9px] text-muted-foreground">({tg.unpaidCount}/{tg.unpaidCount + tg.paidCount})</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <Wallet className="size-3" />
            <span className="text-muted-foreground">Salaries</span>
            <span className="font-semibold">All paid</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">Fines</span>
          <span className="font-semibold tabular-nums">PKR {Math.round(tg.monthFines).toLocaleString()}</span>
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
            {expanded ? "Hide" : `Show ${roster.length} employee${roster.length !== 1 ? "s" : ""}`}
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

function StatPill({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" | "violet" }) {
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
  } as const;
  return (
    <div className={`rounded-md px-2 py-1.5 text-center ${toneClasses[tone]}`}>
      <div className="text-sm font-bold tabular-nums">{value}</div>
      <div className="text-[9px] font-medium opacity-80">{label}</div>
    </div>
  );
}
