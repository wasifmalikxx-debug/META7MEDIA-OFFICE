"use client";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
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
  HALF_DAY: { label: "H", bg: "bg-amber-500" },
  ABSENT: { label: "A", bg: "bg-rose-500" },
  ON_LEAVE: { label: "LV", bg: "bg-violet-500" },
  HOLIDAY: { label: "", bg: "bg-slate-300 dark:bg-slate-600" },
  WEEKEND: { label: "", bg: "bg-slate-200 dark:bg-slate-700" },
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const firstDayOfWeek = new Date(currentYear, currentMonth - 1, 1).getDay();

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

  // Build calendar grid (6 rows x 7 cols)
  const cells: { day: number | null; dateStr: string; isWeekend: boolean; isHoliday: boolean; holidayName: string | null; isToday: boolean; isFuture: boolean }[] = [];

  // Empty cells before first day
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push({ day: null, dateStr: "", isWeekend: false, isHoliday: false, holidayName: null, isToday: false, isFuture: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayOfWeek = new Date(currentYear, currentMonth - 1, d).getDay();
    const isWeekend = weekendDays.includes(dayOfWeek);
    const isHoliday = !!holidayMap[dateStr];
    const holidayName = holidayMap[dateStr] || null;
    const isToday = dateStr === todayStr;
    const isFuture = dateStr > todayStr;
    cells.push({ day: d, dateStr, isWeekend, isHoliday, holidayName, isToday, isFuture });
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

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Present</p>
            <p className="text-2xl font-bold text-emerald-600">{monthPresent}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Absent</p>
            <p className="text-2xl font-bold text-rose-600">{monthAbsent}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Half Day</p>
            <p className="text-2xl font-bold text-amber-600">{monthHalfDay}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Late</p>
            <p className="text-2xl font-bold text-orange-600">{monthLate}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Leaves Bal.</p>
            <p className={`text-2xl font-bold ${pendingLeaves > 1 ? "text-emerald-600" : pendingLeaves > 0 ? "text-amber-600" : "text-rose-600"}`}>{pendingLeaves.toFixed(1)}</p>
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

      {/* Calendar Grid */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardContent className="p-4">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-2">
            {DAY_NAMES.map((name, i) => (
              <div key={name} className={`text-center text-xs font-semibold py-1.5 ${weekendDays.includes(i) ? "text-rose-400" : "text-muted-foreground"}`}>
                {name}
              </div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((cell, idx) => {
              if (!cell.day) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }

              const att = attMap[cell.dateStr];
              let cellStatus: { label: string; bg: string } | null = null;

              if (cell.isFuture) {
                cellStatus = null;
              } else if (cell.isHoliday) {
                cellStatus = STATUS_CELL.HOLIDAY;
              } else if (cell.isWeekend) {
                cellStatus = STATUS_CELL.WEEKEND;
              } else if (att) {
                cellStatus = STATUS_CELL[att.status] || null;
              }

              // Tooltip
              let tooltip = "";
              if (cell.isHoliday) tooltip = `Holiday: ${cell.holidayName}`;
              else if (cell.isWeekend) tooltip = "Day Off";
              else if (att) {
                tooltip = att.status;
                if (att.checkIn) tooltip += ` | In: ${formatPKTTime(att.checkIn)}`;
                if (att.checkOut) tooltip += ` | Out: ${formatPKTTime(att.checkOut)}`;
                if (att.workedMinutes) tooltip += ` | ${Math.floor(att.workedMinutes / 60)}h ${att.workedMinutes % 60}m`;
              }

              return (
                <div
                  key={cell.dateStr}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition-colors cursor-default
                    ${cell.isToday ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900" : ""}
                    ${cell.isWeekend || cell.isHoliday ? "bg-muted/30" : "hover:bg-muted/20"}`}
                  title={tooltip}
                >
                  <span className={`text-[11px] font-medium ${cell.isToday ? "text-blue-600 dark:text-blue-400 font-bold" : cell.isWeekend ? "text-rose-400" : "text-muted-foreground"}`}>
                    {cell.day}
                  </span>
                  {cellStatus && (
                    <div className={`size-5 rounded-md flex items-center justify-center text-[8px] font-bold text-white ${cellStatus.bg}`}>
                      {cellStatus.label}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
