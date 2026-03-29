import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { AttendanceCalendarView } from "@/components/attendance/attendance-calendar-view";
import { getAccumulatedLeaveBudget } from "@/lib/services/leave-budget.service";

export const dynamic = "force-dynamic";

export default async function AttendanceCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") redirect("/dashboard");

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  const [employees, attendances, holidays, settings] = await Promise.all([
    prisma.user.findMany({
      where: { status: { in: ["HIRED", "PROBATION"] }, role: { not: "SUPER_ADMIN" } },
      select: { id: true, firstName: true, lastName: true, employeeId: true, status: true },
      orderBy: { employeeId: "asc" },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: startOfMonth, lte: endOfMonth } },
      select: {
        userId: true, date: true, status: true, checkIn: true, checkOut: true,
        workedMinutes: true, lateMinutes: true,
      },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: startOfMonth, lte: endOfMonth } },
      select: { date: true, name: true },
    }),
    prisma.officeSettings.findUnique({
      where: { id: "default" },
      select: { weekendDays: true, paidLeavesPerMonth: true },
    }),
  ]);

  // Calculate accumulated leave budget per employee
  const leaveBudgets: Record<string, number> = {};
  for (const emp of employees) {
    const budget = await getAccumulatedLeaveBudget(emp.id, settings?.paidLeavesPerMonth ?? 1);
    leaveBudgets[emp.id] = budget.available;
  }

  // Build attendance map: userId -> { "YYYY-MM-DD": status data }
  const attendanceMap: Record<string, Record<string, any>> = {};
  for (const att of attendances) {
    const dateKey = att.date.toISOString().split("T")[0];
    if (!attendanceMap[att.userId]) attendanceMap[att.userId] = {};
    attendanceMap[att.userId][dateKey] = {
      status: att.status,
      checkIn: att.checkIn,
      checkOut: att.checkOut,
      workedMinutes: att.workedMinutes,
      lateMinutes: att.lateMinutes,
    };
  }

  // Holiday map
  const holidayMap: Record<string, string> = {};
  for (const h of holidays) {
    holidayMap[h.date.toISOString().split("T")[0]] = h.name;
  }

  const weekendDays = (settings?.weekendDays || "0").split(",").map((d: string) => parseInt(d.trim()));

  // Calculate summary per employee
  const employeeSummaries = employees.map((emp) => {
    const empAtt = attendanceMap[emp.id] || {};
    let present = 0, absent = 0, late = 0, halfDay = 0, onLeave = 0;

    Object.values(empAtt).forEach((a: any) => {
      switch (a.status) {
        case "PRESENT": present++; break;
        case "LATE": present++; late++; break;
        case "HALF_DAY": halfDay++; break;
        case "ABSENT": absent++; break;
        case "ON_LEAVE": onLeave++; break;
      }
    });

    return {
      ...emp,
      present, absent, late, halfDay, onLeave,
      pendingLeaves: leaveBudgets[emp.id] ?? 1,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance Calendar" />
      <AttendanceCalendarView
        employees={JSON.parse(JSON.stringify(employeeSummaries))}
        attendanceMap={JSON.parse(JSON.stringify(attendanceMap))}
        holidayMap={holidayMap}
        weekendDays={weekendDays}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
