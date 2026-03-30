"use client";

import { useEffect } from "react";
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
  TrendingUp,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { formatPKTTime } from "@/lib/pkt";

interface EmployeeStatus {
  id: string;
  firstName: string;
  lastName: string | null;
  employeeId: string;
  empStatus: string;
  liveStatus: string;
  checkIn: string | null;
  checkOut: string | null;
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

export function AdminDashboard({
  totalEmployees,
  presentToday,
  lateToday,
  absentToday,
  totalPayable,
  totalFines,
  recentAttendances,
  employeeStatuses,
  dayOffLabel,
}: AdminDashboardProps) {
  const router = useRouter();
  const attendanceRate = totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 0;

  useEffect(() => {
    const interval = setInterval(() => { router.refresh(); }, 30_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusOrder: Record<string, number> = {
    ON_BREAK: 0, PRESENT: 1, LATE: 2, HALF_DAY: 3,
    NOT_CHECKED_IN: 4, ABSENT: 5, HALF_DAY_LEAVE: 6, ON_LEAVE: 7, CHECKED_OUT: 8, DAY_OFF: 9,
  };
  const sorted = [...employeeStatuses].sort(
    (a, b) => (statusOrder[a.liveStatus] ?? 9) - (statusOrder[b.liveStatus] ?? 9)
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="size-3.5" />
          META7MEDIA Office
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {/* Total Employees */}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Employees</p>
                <p className="text-3xl font-bold mt-1">{totalEmployees}</p>
                <p className="text-xs text-muted-foreground mt-1">Active workforce</p>
              </div>
              <div className="rounded-xl bg-slate-100 dark:bg-slate-700 p-2.5">
                <Users className="size-5 text-slate-600 dark:text-slate-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Present Today */}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-slate-800">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Present</p>
                <p className="text-3xl font-bold mt-1 text-emerald-700 dark:text-emerald-400">{presentToday}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <TrendingUp className={`size-3 ${attendanceRate >= 80 ? "text-emerald-500" : "text-rose-500"}`} />
                  <span className={`text-xs font-semibold ${attendanceRate >= 80 ? "text-emerald-600" : "text-rose-600"}`}>{attendanceRate}%</span>
                  <span className="text-xs text-muted-foreground">attendance</span>
                </div>
              </div>
              <div className="rounded-xl bg-emerald-100 dark:bg-emerald-900/30 p-2.5">
                <UserCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Late Today */}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Late</p>
                <p className="text-3xl font-bold mt-1 text-amber-700 dark:text-amber-400">{lateToday}</p>
                <p className="text-xs text-muted-foreground mt-1">{lateToday === 0 ? "All on time" : "After grace period"}</p>
              </div>
              <div className="rounded-xl bg-amber-100 dark:bg-amber-900/30 p-2.5">
                <Clock className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Absent / Day Off */}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {dayOffLabel ? "Day Off" : "Absent"}
                </p>
                <p className="text-3xl font-bold mt-1 text-rose-700 dark:text-rose-400">
                  {dayOffLabel ? 0 : absentToday}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {dayOffLabel || (absentToday === 0 ? "Full attendance" : "Not checked in")}
                </p>
              </div>
              <div className="rounded-xl bg-rose-100 dark:bg-rose-900/30 p-2.5">
                {dayOffLabel ? <CalendarOff className="size-5 text-rose-600 dark:text-rose-400" /> : <UserX className="size-5 text-rose-600 dark:text-rose-400" />}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fines */}
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fines</p>
                <p className="text-2xl font-bold mt-1">PKR {totalFines.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">This month</p>
              </div>
              <div className="rounded-xl bg-orange-100 dark:bg-orange-900/30 p-2.5">
                <AlertTriangle className="size-5 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Payable */}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Payable</p>
                <p className="text-2xl font-bold mt-1 text-blue-700 dark:text-blue-400">PKR {totalPayable.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">This month</p>
              </div>
              <div className="rounded-xl bg-blue-100 dark:bg-blue-900/30 p-2.5">
                <Wallet className="size-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Attendance Rate Bar */}
      {!dayOffLabel && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Today's Attendance Rate</span>
              <span className={`text-sm font-bold ${attendanceRate >= 80 ? "text-emerald-600" : attendanceRate >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                {attendanceRate}%
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${attendanceRate >= 80 ? "bg-emerald-500" : attendanceRate >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                style={{ width: `${attendanceRate}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
              <span>{presentToday} present</span>
              <span>{lateToday} late</span>
              <span>{absentToday} absent</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live Employee Status */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg font-bold">Live Status</CardTitle>
              <Badge variant="outline" className="text-[10px] font-normal">
                {sorted.length} employees
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              {dayOffLabel && (
                <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 text-[10px] border-0">
                  {dayOffLabel}
                </Badge>
              )}
              <div className="flex items-center gap-1.5">
                <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-muted-foreground">Live</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-muted/40">
            {sorted.map((emp) => {
              const config = STATUS_CONFIG[emp.liveStatus] || STATUS_CONFIG.NOT_CHECKED_IN;
              const Icon = config.icon;
              return (
                <div
                  key={emp.id}
                  className="flex items-center justify-between py-3 px-5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="relative">
                      <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 text-xs font-bold text-slate-600 dark:text-slate-300">
                        {emp.firstName[0]}{emp.lastName?.[0] || ""}
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white dark:border-slate-900 ${config.dot}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          {emp.firstName} {emp.lastName || ""}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">
                          {emp.employeeId}
                        </span>
                        {emp.empStatus === "PROBATION" && (
                          <Badge className="text-[8px] h-4 px-1.5 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 border-0">
                            PROBATION
                          </Badge>
                        )}
                      </div>
                      {emp.checkIn && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatPKTTime(emp.checkIn)}
                          {emp.checkOut && ` — ${formatPKTTime(emp.checkOut)}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full ${config.color}`}>
                    <Icon className="size-3.5" />
                    {config.label}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
