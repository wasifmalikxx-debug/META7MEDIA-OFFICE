import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { AttendanceCalendarView } from "@/components/attendance/attendance-calendar-view";

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

  // Calculate accumulated leave budget per employee (batched — 3 queries total, not per employee)
  const empIds = employees.map((e) => e.id);
  const paidLeavesPerMonth = settings?.paidLeavesPerMonth ?? 1;

  const [firstAttendances, coveredFines, halfDayAttendances] = await Promise.all([
    // First attendance per employee (for monthsActive calculation)
    prisma.attendance.findMany({
      where: { userId: { in: empIds } },
      orderBy: { date: "asc" },
      distinct: ["userId"],
      select: { userId: true, date: true },
    }),
    // Covered absences (fines with amount=0) — only from April 2026 onwards
    prisma.fine.groupBy({
      by: ["userId"],
      where: { userId: { in: empIds }, amount: 0, reason: { contains: "Covered by paid leave" }, date: { gte: new Date(Date.UTC(2026, 3, 1)) } },
      _count: true,
    }),
    // Half-day attendance count per employee
    prisma.attendance.groupBy({
      by: ["userId"],
      where: { userId: { in: empIds }, status: "HALF_DAY" },
      _count: true,
    }),
  ]);

  const firstAttMap: Record<string, Date> = {};
  firstAttendances.forEach((a) => { firstAttMap[a.userId] = a.date; });
  const coveredMap: Record<string, number> = {};
  coveredFines.forEach((f: any) => { coveredMap[f.userId] = f._count; });
  const halfDayMap: Record<string, number> = {};
  halfDayAttendances.forEach((a: any) => { halfDayMap[a.userId] = a._count; });

  const now = new Date(Date.now() + 5 * 60 * 60_000); // PKT
  // System start: April 2026 (must match leave-budget.service.ts)
  const SYS_START_YEAR = 2026;
  const SYS_START_MONTH = 3; // 0-indexed: 3 = April
  const leaveBudgets: Record<string, number> = {};
  for (const emp of employees) {
    const monthsActive = Math.max(1, (now.getUTCFullYear() - SYS_START_YEAR) * 12 + (now.getUTCMonth() - SYS_START_MONTH) + 1);
    const totalEarned = monthsActive * paidLeavesPerMonth;
    const totalUsed = (coveredMap[emp.id] || 0);
    leaveBudgets[emp.id] = Math.max(0, totalEarned - totalUsed);
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
