"use client";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

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

const STATUS_CELL: Record<string, { label: string; bg: string; text: string }> = {
  PRESENT: { label: "P", bg: "bg-green-500", text: "text-white" },
  LATE: { label: "L", bg: "bg-yellow-500", text: "text-white" },
  HALF_DAY: { label: "H", bg: "bg-orange-500", text: "text-white" },
  ABSENT: { label: "A", bg: "bg-red-500", text: "text-white" },
  ON_LEAVE: { label: "LV", bg: "bg-purple-500", text: "text-white" },
  HOLIDAY: { label: "-", bg: "bg-slate-300 dark:bg-slate-700", text: "text-slate-600 dark:text-slate-400" },
  WEEKEND: { label: "-", bg: "bg-slate-200 dark:bg-slate-800", text: "text-slate-400 dark:text-slate-500" },
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AttendanceCalendarView({
  employees,
  attendanceMap,
  holidayMap,
  weekendDays,
  currentMonth,
  currentYear,
}: AttendanceCalendarViewProps) {
  const router = useRouter();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);

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

  // Build day info array
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dateObj = new Date(currentYear, currentMonth - 1, day);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = weekendDays.includes(dayOfWeek);
    const isHoliday = !!holidayMap[dateStr];
    const holidayName = holidayMap[dateStr] || null;
    const isFuture = dateStr > todayStr;
    return { day, dateStr, dayOfWeek, isWeekend, isHoliday, holidayName, isFuture };
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
    if (att.checkIn) text += ` | In: ${format(new Date(att.checkIn), "hh:mm a")}`;
    if (att.checkOut) text += ` | Out: ${format(new Date(att.checkOut), "hh:mm a")}`;
    if (att.workedMinutes) text += ` | ${Math.floor(att.workedMinutes / 60)}h ${att.workedMinutes % 60}m`;
    if (att.lateMinutes) text += ` | Late: ${att.lateMinutes}m`;
    return text;
  }

  return (
    <div className="space-y-4">
      {/* Month Navigation */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => goMonth(-1)} className="size-8">
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="text-lg font-bold min-w-[180px] text-center">{monthName}</h2>
        <Button variant="outline" size="icon" onClick={() => goMonth(1)} className="size-8">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(STATUS_CELL).filter(([k]) => k !== "HOLIDAY").map(([key, val]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`size-4 rounded ${val.bg}`} />
            <span className="text-muted-foreground">{key === "WEEKEND" ? "Weekend/Holiday" : key.replace("_", " ")}</span>
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/30">
                <th className="sticky left-0 z-10 bg-muted/80 backdrop-blur px-3 py-2 text-left font-semibold min-w-[140px] border-r">
                  Employee
                </th>
                {days.map((d) => (
                  <th
                    key={d.day}
                    className={`px-0.5 py-2 text-center font-medium min-w-[28px] ${d.isWeekend || d.isHoliday ? "bg-slate-100 dark:bg-slate-800/50" : ""}`}
                  >
                    <div className="leading-tight">
                      <div className="text-[10px] text-muted-foreground">{DAY_NAMES[d.dayOfWeek]}</div>
                      <div>{d.day}</div>
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2 text-center font-semibold border-l bg-muted/50 min-w-[32px]">P</th>
                <th className="px-2 py-2 text-center font-semibold bg-muted/50 min-w-[32px]">A</th>
                <th className="px-2 py-2 text-center font-semibold bg-muted/50 min-w-[32px]">L</th>
                <th className="px-2 py-2 text-center font-semibold bg-muted/50 min-w-[32px]">HD</th>
                <th className="px-2 py-2 text-center font-semibold bg-muted/50 min-w-[48px]">Leaves</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-t border-muted/30 hover:bg-muted/10">
                  <td className="sticky left-0 z-10 bg-card backdrop-blur px-3 py-1.5 border-r">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate max-w-[90px]">{emp.firstName}</span>
                      <span className="text-[9px] text-muted-foreground font-mono">{emp.employeeId}</span>
                      {emp.status === "PROBATION" && (
                        <span className="text-[8px] px-1 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">P</span>
                      )}
                    </div>
                  </td>
                  {days.map((d) => {
                    const cell = getCellInfo(emp.id, d.dateStr, d.isWeekend, d.isHoliday, d.isFuture);
                    return (
                      <td
                        key={d.day}
                        className={`px-0.5 py-1.5 text-center ${d.isWeekend || d.isHoliday ? "bg-slate-50 dark:bg-slate-800/30" : ""}`}
                        title={d.isFuture ? "" : getTooltipText(emp.id, d.dateStr, d.isHoliday, d.holidayName)}
                      >
                        {cell && (
                          <div className={`inline-flex items-center justify-center size-5 rounded text-[9px] font-bold ${cell.bg} ${cell.text}`}>
                            {cell.label}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center border-l font-semibold text-green-600">{emp.present}</td>
                  <td className="px-2 py-1.5 text-center font-semibold text-red-600">{emp.absent}</td>
                  <td className="px-2 py-1.5 text-center font-semibold text-yellow-600">{emp.late}</td>
                  <td className="px-2 py-1.5 text-center font-semibold text-orange-600">{emp.halfDay}</td>
                  <td className="px-2 py-1.5 text-center">
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">
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
