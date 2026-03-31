"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { formatPKTTime } from "@/lib/pkt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, Calendar, Users, UserCheck, UserX,
  Clock, CalendarOff,
} from "lucide-react";

interface EmployeeSummary {
  id: string;
  firstName: string;
  lastName: string | null;
  employeeId: string;
  status: string;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  onLeave: number;
  pendingLeaves: number;
}

interface AttendanceCalendarViewProps {
  employees: EmployeeSummary[];
  attendanceMap: Record<string, Record<string, any>>;
  holidayMap: Record<string, string>;
  weekendDays: number[];
  currentMonth: number;
  currentYear: number;
}

const STATUS_CELL: Record<string, { label: string; bg: string }> = {
  PRESENT: { label: "P", bg: "bg-emerald-500" },
  LATE: { label: "P", bg: "bg-emerald-500" },
  HALF_DAY: { label: "H", bg: "bg-amber-500" },
  ABSENT: { label: "A", bg: "bg-rose-500" },
  ON_LEAVE: { label: "LV", bg: "bg-violet-500" },
  HOLIDAY: { label: "", bg: "bg-slate-300 dark:bg-slate-600" },
  WEEKEND: { label: "", bg: "bg-slate-200 dark:bg-slate-700" },
};

const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];

export function AttendanceCalendarView({
  employees,
  attendanceMap,
  holidayMap,
  weekendDays,
  currentMonth,
  currentYear,
}: AttendanceCalendarViewProps) {
  const router = useRouter();

  const monthName = format(new Date(currentYear, currentMonth - 1), "MMMM yyyy");
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const pktNow = new Date(Date.now() + 5 * 60 * 60_000);
  const todayStr = `${pktNow.getUTCFullYear()}-${String(pktNow.getUTCMonth() + 1).padStart(2, "0")}-${String(pktNow.getUTCDate()).padStart(2, "0")}`;

  function goMonth(offset: number) {
    let m = currentMonth + offset;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    router.push(`/attendance-calendar?month=${m}&year=${y}`);
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dateObj = new Date(currentYear, currentMonth - 1, day);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = weekendDays.includes(dayOfWeek);
    const isHoliday = !!holidayMap[dateStr];
    const holidayName = holidayMap[dateStr] || null;
    const isFuture = dateStr > todayStr;
    const isToday = dateStr === todayStr;
    return { day, dateStr, dayOfWeek, isWeekend, isHoliday, holidayName, isFuture, isToday };
  });

  function getCellInfo(empId: string, dateStr: string, isWeekend: boolean, isHoliday: boolean, isFuture: boolean) {
    if (isFuture) return null;
    if (isHoliday) return STATUS_CELL.HOLIDAY;
    if (isWeekend) return STATUS_CELL.WEEKEND;
    const att = attendanceMap[empId]?.[dateStr];
    if (!att) return null;
    return STATUS_CELL[att.status] || null;
  }

  function getTooltipText(empId: string, dateStr: string, isHoliday: boolean, holidayName: string | null) {
    if (isHoliday) return `Holiday: ${holidayName}`;
    const att = attendanceMap[empId]?.[dateStr];
    if (!att) return "No record";
    let text = att.status;
    if (att.checkIn) text += ` | In: ${formatPKTTime(att.checkIn)}`;
    if (att.checkOut) text += ` | Out: ${formatPKTTime(att.checkOut)}`;
    if (att.workedMinutes) text += ` | ${Math.floor(att.workedMinutes / 60)}h ${att.workedMinutes % 60}m`;
    if (att.lateMinutes) text += ` | Late: ${att.lateMinutes}m`;
    return text;
  }

  // Overall stats
  const totalPresent = employees.reduce((s, e) => s + e.present, 0);
  const totalAbsent = employees.reduce((s, e) => s + e.absent, 0);
  const totalHalfDay = employees.reduce((s, e) => s + e.halfDay, 0);
  const totalOnLeave = employees.reduce((s, e) => s + e.onLeave, 0);

  // Split by team
  const etsyEmployees = employees.filter((e) => e.employeeId.startsWith("EM"));
  const fbEmployees = employees.filter((e) => e.employeeId.startsWith("SMM"));

  function renderTeamGrid(teamEmployees: EmployeeSummary[], teamName: string, teamColor: string) {
    if (teamEmployees.length === 0) return null;
    return (
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardHeader className={`py-2.5 px-5 border-b ${teamColor}`}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-bold">{teamName}</CardTitle>
            <Badge variant="outline" className="text-[9px] h-5">{teamEmployees.length} members</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-muted/80 backdrop-blur px-4 py-2.5 text-left font-semibold min-w-[150px] border-b border-r text-[11px]">
                  Employee
                </th>
                {days.map((d) => (
                  <th
                    key={d.day}
                    className={`px-0 py-2 text-center min-w-[28px] border-b
                      ${d.isToday ? "bg-blue-50 dark:bg-blue-950/30" : d.isWeekend || d.isHoliday ? "bg-muted/50" : "bg-muted/20"}`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`text-[9px] font-medium ${d.isWeekend ? "text-rose-400" : "text-muted-foreground"}`}>
                        {DAY_NAMES[d.dayOfWeek]}
                      </span>
                      <span className={`text-[10px] font-bold ${d.isToday ? "bg-blue-500 text-white size-4.5 rounded-full inline-flex items-center justify-center" : ""}`}>
                        {d.day}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2 text-center font-bold border-b border-l bg-emerald-50/50 dark:bg-emerald-950/10 min-w-[32px] text-emerald-600 dark:text-emerald-400 text-[10px]">P</th>
                <th className="px-2 py-2 text-center font-bold border-b bg-rose-50/50 dark:bg-rose-950/10 min-w-[32px] text-rose-600 dark:text-rose-400 text-[10px]">A</th>
                <th className="px-2 py-2 text-center font-bold border-b bg-amber-50/50 dark:bg-amber-950/10 min-w-[32px] text-amber-600 dark:text-amber-400 text-[10px]">HD</th>
                <th className="px-2 py-2 text-center font-bold border-b bg-violet-50/50 dark:bg-violet-950/10 min-w-[44px] text-violet-600 dark:text-violet-400 text-[10px]">Bal</th>
              </tr>
            </thead>
            <tbody>
              {teamEmployees.map((emp, idx) => (
                <React.Fragment key={emp.id}>
                  {/* Status row */}
                  <tr className={`group transition-colors hover:bg-muted/20 ${idx % 2 === 0 ? "bg-card" : "bg-muted/5"}`}>
                    <td rowSpan={3} className={`sticky left-0 z-10 px-3 py-1 border-r border-b ${idx % 2 === 0 ? "bg-card" : "bg-muted/5"} group-hover:bg-muted/20 transition-colors align-middle`}>
                      <div className="flex items-center gap-2">
                        <div className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 text-[9px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
                          {emp.firstName[0]}{emp.lastName?.[0] || ""}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-[10px] leading-tight truncate max-w-[80px]">
                            {emp.firstName} {emp.lastName?.[0] ? emp.lastName[0] + "." : ""}
                          </span>
                          <span className="text-[8px] text-muted-foreground font-mono leading-tight">{emp.employeeId}</span>
                        </div>
                        {emp.status === "PROBATION" && (
                          <span className="text-[7px] px-1 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 font-bold leading-none">P</span>
                        )}
                      </div>
                    </td>
                    {days.map((d) => {
                      const cell = getCellInfo(emp.id, d.dateStr, d.isWeekend, d.isHoliday, d.isFuture);
                      return (
                        <td key={d.day} className={`px-0 py-1 text-center ${d.isToday ? "bg-blue-50/40 dark:bg-blue-950/10" : d.isWeekend || d.isHoliday ? "bg-muted/15" : ""}`} title={d.isFuture ? "" : getTooltipText(emp.id, d.dateStr, d.isHoliday, d.holidayName)}>
                          {cell ? (
                            <div className={`inline-flex items-center justify-center size-5 rounded text-[8px] font-bold text-white ${cell.bg}`}>{cell.label}</div>
                          ) : d.isFuture ? <span className="text-muted-foreground/20 text-[8px]">·</span> : null}
                        </td>
                      );
                    })}
                    <td rowSpan={3} className="px-1.5 py-1 text-center border-l border-b align-middle">
                      <span className="inline-flex items-center justify-center size-5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">{emp.present}</span>
                    </td>
                    <td rowSpan={3} className="px-1.5 py-1 text-center border-b align-middle">
                      <span className={`inline-flex items-center justify-center size-5 rounded text-[10px] font-bold ${emp.absent > 0 ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400" : "text-muted-foreground/30"}`}>{emp.absent}</span>
                    </td>
                    <td rowSpan={3} className="px-1.5 py-1 text-center border-b align-middle">
                      <span className={`inline-flex items-center justify-center size-5 rounded text-[10px] font-bold ${emp.halfDay > 0 ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" : "text-muted-foreground/30"}`}>{emp.halfDay}</span>
                    </td>
                    <td rowSpan={3} className="px-1.5 py-1 text-center border-b align-middle">
                      <Badge variant="outline" className={`text-[8px] px-1 py-0 font-bold ${emp.pendingLeaves > 1 ? "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400" : emp.pendingLeaves > 0 ? "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400" : "border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400"}`}>
                        {emp.pendingLeaves.toFixed(1)}
                      </Badge>
                    </td>
                  </tr>
                  {/* Check-in time row */}
                  <tr className={`${idx % 2 === 0 ? "bg-card" : "bg-muted/5"}`}>
                    {days.map((d) => {
                      const att = attendanceMap[emp.id]?.[d.dateStr];
                      return (
                        <td key={d.day} className={`px-0 py-0 text-center ${d.isWeekend || d.isHoliday ? "bg-muted/10" : ""}`}>
                          {att?.checkIn && <span className="text-[7px] text-emerald-600 dark:text-emerald-400 font-mono">{formatPKTTime(att.checkIn)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Check-out time row */}
                  <tr className={`border-b border-muted/30 ${idx % 2 === 0 ? "bg-card" : "bg-muted/5"}`}>
                    {days.map((d) => {
                      const att = attendanceMap[emp.id]?.[d.dateStr];
                      return (
                        <td key={d.day} className={`px-0 py-0 pb-0.5 text-center ${d.isWeekend || d.isHoliday ? "bg-muted/10" : ""}`}>
                          {att?.checkOut && <span className="text-[7px] text-rose-500 dark:text-rose-400 font-mono">{formatPKTTime(att.checkOut)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => goMonth(-1)} className="size-9 rounded-full">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-[200px] justify-center">
            <Calendar className="size-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">{monthName}</h2>
          </div>
          <Button variant="outline" size="icon" onClick={() => goMonth(1)} className="size-9 rounded-full">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="size-3.5 text-slate-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Employees</p>
            </div>
            <p className="text-3xl font-bold">{employees.length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <UserCheck className="size-3.5 text-emerald-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Present Days</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{totalPresent}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <UserX className="size-3.5 text-rose-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Absent Days</p>
            </div>
            <p className="text-3xl font-bold text-rose-600 dark:text-rose-400">{totalAbsent}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="size-3.5 text-amber-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Half Days</p>
            </div>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{totalHalfDay}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <CalendarOff className="size-3.5 text-violet-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">On Leave</p>
            </div>
            <p className="text-3xl font-bold text-violet-600 dark:text-violet-400">{totalOnLeave}</p>
          </CardContent>
        </Card>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-emerald-500" /><span>Present</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-rose-500" /><span>Absent</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-amber-500" /><span>Half Day</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-violet-500" /><span>On Leave</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-slate-300 dark:bg-slate-600" /><span>Day Off</span></div>
      </div>

      {/* Team Grids — Separate Cards */}
      {renderTeamGrid(etsyEmployees, "Etsy Team", "bg-emerald-50/40 dark:bg-emerald-950/15")}
      {renderTeamGrid(fbEmployees, "Facebook Team", "bg-blue-50/40 dark:bg-blue-950/15")}
    </div>
  );
}
