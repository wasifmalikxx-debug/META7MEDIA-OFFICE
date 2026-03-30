"use client";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { formatPKTTime } from "@/lib/pkt";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

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
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
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

        {/* Summary pills */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-full">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{totalPresent} Present</span>
          </div>
          <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 rounded-full">
            <div className="size-2 rounded-full bg-rose-500" />
            <span className="text-xs font-medium text-rose-700 dark:text-rose-400">{totalAbsent} Absent</span>
          </div>
          <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 rounded-full">
            <div className="size-2 rounded-full bg-amber-500" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{totalHalfDay} Half Day</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-emerald-500" /><span>Present</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-rose-500" /><span>Absent</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-amber-500" /><span>Half Day</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-violet-500" /><span>On Leave</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-slate-300 dark:bg-slate-600" /><span>Weekend / Holiday</span></div>
      </div>

      {/* Calendar Grid */}
      <Card className="overflow-hidden border-0 shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            {/* Day headers */}
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-muted px-4 py-3 text-left font-semibold text-sm min-w-[160px] border-b border-r">
                  Employee
                </th>
                {days.map((d) => (
                  <th
                    key={d.day}
                    className={`px-0 py-2.5 text-center min-w-[30px] border-b transition-colors
                      ${d.isToday ? "bg-blue-50 dark:bg-blue-950/30" : d.isWeekend || d.isHoliday ? "bg-muted/60" : "bg-muted/30"}`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`text-[10px] font-medium ${d.isWeekend ? "text-rose-400" : "text-muted-foreground"}`}>
                        {DAY_NAMES[d.dayOfWeek]}
                      </span>
                      <span className={`text-[11px] font-bold ${d.isToday ? "bg-blue-500 text-white size-5 rounded-full inline-flex items-center justify-center" : ""}`}>
                        {d.day}
                      </span>
                    </div>
                  </th>
                ))}
                {/* Summary headers */}
                <th className="px-2 py-2.5 text-center font-semibold border-b border-l bg-emerald-50 dark:bg-emerald-950/20 min-w-[36px]">
                  <span className="text-emerald-600 dark:text-emerald-400">P</span>
                </th>
                <th className="px-2 py-2.5 text-center font-semibold border-b bg-rose-50 dark:bg-rose-950/20 min-w-[36px]">
                  <span className="text-rose-600 dark:text-rose-400">A</span>
                </th>
                <th className="px-2 py-2.5 text-center font-semibold border-b bg-amber-50 dark:bg-amber-950/20 min-w-[36px]">
                  <span className="text-amber-600 dark:text-amber-400">HD</span>
                </th>
                <th className="px-2 py-2.5 text-center font-semibold border-b bg-violet-50 dark:bg-violet-950/20 min-w-[50px]">
                  <span className="text-violet-600 dark:text-violet-400">Bal</span>
                </th>
              </tr>
            </thead>

            {/* Employee rows */}
            <tbody>
              {employees.map((emp, idx) => (
                <tr
                  key={emp.id}
                  className={`group transition-colors hover:bg-muted/20 ${idx % 2 === 0 ? "bg-card" : "bg-muted/5"}`}
                >
                  {/* Employee name */}
                  <td className={`sticky left-0 z-10 px-4 py-2 border-r ${idx % 2 === 0 ? "bg-card" : "bg-muted/5"} group-hover:bg-muted/20 transition-colors`}>
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 text-[10px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
                        {emp.firstName[0]}{emp.lastName?.[0] || ""}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-[11px] leading-tight truncate max-w-[85px]">
                          {emp.firstName} {emp.lastName?.[0] ? emp.lastName[0] + "." : ""}
                        </span>
                        <span className="text-[9px] text-muted-foreground font-mono leading-tight">{emp.employeeId}</span>
                      </div>
                      {emp.status === "PROBATION" && (
                        <span className="text-[7px] px-1 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 font-bold leading-none">
                          PRB
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Day cells */}
                  {days.map((d) => {
                    const cell = getCellInfo(emp.id, d.dateStr, d.isWeekend, d.isHoliday, d.isFuture);
                    return (
                      <td
                        key={d.day}
                        className={`px-0 py-1.5 text-center transition-colors
                          ${d.isToday ? "bg-blue-50/50 dark:bg-blue-950/10" : d.isWeekend || d.isHoliday ? "bg-muted/20" : ""}`}
                        title={d.isFuture ? "" : getTooltipText(emp.id, d.dateStr, d.isHoliday, d.holidayName)}
                      >
                        {cell ? (
                          <div className={`inline-flex items-center justify-center size-6 rounded-md text-[9px] font-bold text-white shadow-sm ${cell.bg}`}>
                            {cell.label}
                          </div>
                        ) : d.isFuture ? (
                          <div className="inline-flex items-center justify-center size-6 rounded-md text-[9px] text-muted-foreground/30">
                            ·
                          </div>
                        ) : null}
                      </td>
                    );
                  })}

                  {/* Summary cells */}
                  <td className="px-2 py-1.5 text-center border-l">
                    <span className="inline-flex items-center justify-center size-6 rounded-md bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold">
                      {emp.present}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-flex items-center justify-center size-6 rounded-md text-[11px] font-bold ${emp.absent > 0 ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400" : "text-muted-foreground/40"}`}>
                      {emp.absent}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-flex items-center justify-center size-6 rounded-md text-[11px] font-bold ${emp.halfDay > 0 ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" : "text-muted-foreground/40"}`}>
                      {emp.halfDay}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0.5 font-bold ${emp.pendingLeaves > 1 ? "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400" : emp.pendingLeaves > 0 ? "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400" : "border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400"}`}>
                      {emp.pendingLeaves.toFixed(1)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
