"use client";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar, Clock, CheckCircle, XCircle, Coffee as CoffeeIcon } from "lucide-react";
import { formatPKTTime } from "@/lib/pkt";

interface MyAttendanceCalendarProps {
  attendances: any[];
  holidayMap: Record<string, string>;
  weekendDays: number[];
  currentMonth: number;
  currentYear: number;
  pendingLeaves: number;
  monthPresent: number;
  monthAbsent: number;
  monthLate: number;
  monthHalfDay: number;
}

const STATUS_CELL: Record<string, { label: string; bg: string }> = {
  PRESENT: { label: "P", bg: "bg-emerald-500" },
  LATE: { label: "P", bg: "bg-emerald-500" },
  HALF_DAY: { label: "H", bg: "bg-blue-500" },
  ABSENT: { label: "A", bg: "bg-rose-500" },
  ON_LEAVE: { label: "LV", bg: "bg-violet-500" },
  HOLIDAY: { label: "", bg: "bg-slate-300 dark:bg-slate-600" },
  WEEKEND: { label: "", bg: "bg-slate-200 dark:bg-slate-700" },
};

const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];

export function MyAttendanceCalendar({
  attendances,
  holidayMap,
  weekendDays,
  currentMonth,
  currentYear,
  pendingLeaves,
  monthPresent,
  monthAbsent,
  monthLate,
  monthHalfDay,
}: MyAttendanceCalendarProps) {
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
    router.push(`/attendance?month=${m}&year=${y}`);
  }

  // Build attendance map by date
  const attMap: Record<string, any> = {};
  attendances.forEach((a: any) => {
    const dateKey = a.date?.split("T")[0] || new Date(a.date).toISOString().split("T")[0];
    attMap[dateKey] = a;
  });

  // Build day info
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dateObj = new Date(currentYear, currentMonth - 1, day);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = weekendDays.includes(dayOfWeek);
    const isHoliday = !!holidayMap[dateStr];
    const holidayName = holidayMap[dateStr] || null;
    const isToday = dateStr === todayStr;
    const isFuture = dateStr > todayStr;
    return { day, dateStr, dayOfWeek, isWeekend, isHoliday, holidayName, isToday, isFuture };
  });

  // Total worked hours
  const totalWorkedMin = attendances.reduce((s: number, a: any) => s + (a.workedMinutes || 0), 0);
  const totalWorkedH = Math.floor(totalWorkedMin / 60);
  const totalWorkedM = totalWorkedMin % 60;

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

        {/* Quick stats pills */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-full">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{monthPresent} Present</span>
          </div>
          <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 rounded-full">
            <div className="size-2 rounded-full bg-rose-500" />
            <span className="text-xs font-semibold text-rose-700 dark:text-rose-400">{monthAbsent} Absent</span>
          </div>
          <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 rounded-full">
            <div className="size-2 rounded-full bg-blue-500" />
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">{monthHalfDay} Half Day</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="size-3.5 text-emerald-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Present</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{monthPresent}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="size-3.5 text-rose-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Absent</p>
            </div>
            <p className="text-3xl font-bold text-rose-600 dark:text-rose-400">{monthAbsent}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <CoffeeIcon className="size-3.5 text-blue-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Half Day</p>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{monthHalfDay}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="size-3.5 text-blue-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Hours</p>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalWorkedH}<span className="text-lg">h</span> {totalWorkedM}<span className="text-lg">m</span></p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="size-3.5 text-violet-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Leave Bal.</p>
            </div>
            <p className={`text-3xl font-bold ${pendingLeaves > 1 ? "text-emerald-600 dark:text-emerald-400" : pendingLeaves > 0 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{pendingLeaves.toFixed(1)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Horizontal Grid Calendar (same style as CEO) */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-muted px-4 py-3 text-left font-semibold text-sm min-w-[100px] border-b border-r">
                  Status
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
              </tr>
            </thead>
            <tbody>
              <tr className="hover:bg-muted/10">
                <td className="sticky left-0 z-10 bg-card px-4 py-3 border-r">
                  <span className="font-semibold text-sm">Attendance</span>
                </td>
                {days.map((d) => {
                  let cell: { label: string; bg: string } | null = null;
                  if (d.isFuture) cell = null;
                  else if (d.isHoliday) cell = STATUS_CELL.HOLIDAY;
                  else if (d.isWeekend) cell = STATUS_CELL.WEEKEND;
                  else if (attMap[d.dateStr]) cell = STATUS_CELL[attMap[d.dateStr].status] || null;

                  const att = attMap[d.dateStr];
                  let tooltip = "";
                  if (d.isHoliday) tooltip = `Holiday: ${d.holidayName}`;
                  else if (d.isWeekend) tooltip = "Day Off";
                  else if (att) {
                    tooltip = att.status;
                    if (att.checkIn) tooltip += ` | In: ${formatPKTTime(att.checkIn)}`;
                    if (att.checkOut) tooltip += ` | Out: ${formatPKTTime(att.checkOut)}`;
                    if (att.workedMinutes) tooltip += ` | ${Math.floor(att.workedMinutes / 60)}h ${att.workedMinutes % 60}m`;
                  }

                  return (
                    <td
                      key={d.day}
                      className={`px-0 py-2.5 text-center ${d.isToday ? "bg-blue-50/50 dark:bg-blue-950/10" : d.isWeekend || d.isHoliday ? "bg-muted/20" : ""}`}
                      title={tooltip}
                    >
                      {cell ? (
                        <div className={`inline-flex items-center justify-center size-6 rounded-md text-[9px] font-bold text-white shadow-sm ${cell.bg}`}>
                          {cell.label}
                        </div>
                      ) : d.isFuture ? (
                        <div className="inline-flex items-center justify-center size-6 rounded-md text-[9px] text-muted-foreground/30">·</div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>

              {/* Check-in times row */}
              <tr className="hover:bg-muted/10 border-t border-muted/20">
                <td className="sticky left-0 z-10 bg-card px-4 py-2 border-r">
                  <span className="text-[11px] text-muted-foreground font-medium">Check In</span>
                </td>
                {days.map((d) => {
                  const att = attMap[d.dateStr];
                  return (
                    <td key={d.day} className={`px-0 py-2 text-center ${d.isWeekend || d.isHoliday ? "bg-muted/10" : ""}`}>
                      {att?.checkIn && (
                        <span className="text-[9px] text-muted-foreground font-mono">{formatPKTTime(att.checkIn)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Check-out times row */}
              <tr className="hover:bg-muted/10 border-t border-muted/20">
                <td className="sticky left-0 z-10 bg-card px-4 py-2 border-r">
                  <span className="text-[11px] text-muted-foreground font-medium">Check Out</span>
                </td>
                {days.map((d) => {
                  const att = attMap[d.dateStr];
                  return (
                    <td key={d.day} className={`px-0 py-2 text-center ${d.isWeekend || d.isHoliday ? "bg-muted/10" : ""}`}>
                      {att?.checkOut && (
                        <span className="text-[9px] text-muted-foreground font-mono">{formatPKTTime(att.checkOut)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Worked hours row */}
              <tr className="hover:bg-muted/10 border-t border-muted/20">
                <td className="sticky left-0 z-10 bg-card px-4 py-2 border-r">
                  <span className="text-[11px] text-muted-foreground font-medium">Hours</span>
                </td>
                {days.map((d) => {
                  const att = attMap[d.dateStr];
                  return (
                    <td key={d.day} className={`px-0 py-2 text-center ${d.isWeekend || d.isHoliday ? "bg-muted/10" : ""}`}>
                      {att?.workedMinutes ? (
                        <span className="text-[9px] text-muted-foreground font-mono">{Math.floor(att.workedMinutes / 60)}h{att.workedMinutes % 60 > 0 ? `${att.workedMinutes % 60}m` : ""}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-emerald-500" /><span>Present</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-rose-500" /><span>Absent</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-blue-500" /><span>Half Day</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-violet-500" /><span>On Leave</span></div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-sm bg-slate-300 dark:bg-slate-600" /><span>Day Off</span></div>
      </div>
    </div>
  );
}
