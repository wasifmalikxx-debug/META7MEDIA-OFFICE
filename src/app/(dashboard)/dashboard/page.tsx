import { auth } from "@/lib/auth";
import { prisma, getCachedSettings } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { todayPKT, nowPKT, pktMonth, pktYear } from "@/lib/pkt";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userRole = (session.user as any).role;
  const userId = session.user.id;

  const today = todayPKT();
  const month = pktMonth();
  const year = pktYear();

  if (userRole === "SUPER_ADMIN" || userRole === "HR_ADMIN") {
    // Admin dashboard — all queries in ONE batch
    const [allEmployees, todayAttendances, payrollRecords, fines, todayLeaves, officeSettings, todayHoliday] = await Promise.all([
      prisma.user.findMany({
        where: { status: { in: ["HIRED", "PROBATION"] }, role: { not: "SUPER_ADMIN" } },
        select: { id: true, firstName: true, lastName: true, employeeId: true, status: true },
        orderBy: { employeeId: "asc" },
      }),
      prisma.attendance.findMany({
        where: { date: today },
        select: {
          id: true, userId: true, status: true, checkIn: true, checkOut: true,
          breakStart: true, breakEnd: true, lateMinutes: true,
          user: { select: { firstName: true, lastName: true, employeeId: true } },
        },
      }),
      prisma.payrollRecord.findMany({
        where: { month, year },
        select: { netSalary: true },
      }),
      prisma.fine.findMany({
        where: { month, year },
        select: { amount: true },
      }),
      prisma.leaveRequest.findMany({
        where: { startDate: { lte: today }, endDate: { gte: today }, status: "APPROVED" },
        select: { userId: true, leaveType: true },
      }),
      prisma.officeSettings.findUnique({ where: { id: "default" }, select: { weekendDays: true } }),
      prisma.holiday.findFirst({ where: { date: today } }),
    ]);

    const totalEmployees = allEmployees.length;
    const presentToday = todayAttendances.filter(
      (a) => a.status === "PRESENT" || a.status === "LATE"
    ).length;
    const lateToday = todayAttendances.filter((a) => a.status === "LATE").length;
    const absentToday = totalEmployees - todayAttendances.filter(
      (a) => a.status !== "ABSENT"
    ).length;
    const totalPayable = payrollRecords.reduce((sum, p) => sum + p.netSalary, 0);
    const totalFines = fines.reduce((sum, f) => sum + f.amount, 0);

    // Build attendance map for quick lookup
    const attendanceMap: Record<string, any> = {};
    for (const att of todayAttendances) {
      attendanceMap[att.userId] = att;
    }
    const leaveMap: Record<string, string> = {};
    for (const lv of todayLeaves) {
      leaveMap[lv.userId] = lv.leaveType;
    }

    // Detect weekend / holiday
    const pktDayOfWeek = nowPKT().getUTCDay(); // 0=Sun, 6=Sat
    const weekendDays = (officeSettings?.weekendDays || "0").split(",").map((d: string) => parseInt(d.trim()));
    const isWeekend = weekendDays.includes(pktDayOfWeek);
    const holidayName = todayHoliday?.name || null;
    const isDayOff = isWeekend || !!holidayName;

    // Build full employee list with live status
    const employeeStatuses = allEmployees.map((emp) => {
      const att = attendanceMap[emp.id];
      const leave = leaveMap[emp.id];
      let liveStatus = isDayOff ? "DAY_OFF" : "NOT_CHECKED_IN";
      let checkInTime = null;
      let checkOutTime = null;

      if (att) {
        if (att.checkOut) {
          liveStatus = "CHECKED_OUT";
          checkInTime = att.checkIn;
          checkOutTime = att.checkOut;
        } else if (att.breakStart && !att.breakEnd) {
          liveStatus = "ON_BREAK";
          checkInTime = att.checkIn;
        } else if (att.status === "PRESENT" || att.status === "LATE") {
          liveStatus = att.status === "LATE" ? "LATE" : "PRESENT";
          checkInTime = att.checkIn;
        } else if (att.status === "ABSENT") {
          liveStatus = "ABSENT";
        } else if (att.status === "HALF_DAY") {
          liveStatus = "HALF_DAY";
          checkInTime = att.checkIn;
        }
      }

      if (leave) {
        if (leave === "HALF_DAY" && liveStatus !== "CHECKED_OUT" && liveStatus !== "PRESENT" && liveStatus !== "LATE") {
          liveStatus = "HALF_DAY_LEAVE";
        } else if (leave === "FULL_DAY") {
          liveStatus = "ON_LEAVE";
        }
      }

      return {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        employeeId: emp.employeeId,
        empStatus: emp.status,
        liveStatus,
        checkIn: checkInTime,
        checkOut: checkOutTime,
      };
    });

    return (
      <AdminDashboard
        totalEmployees={totalEmployees}
        presentToday={presentToday}
        lateToday={lateToday}
        absentToday={absentToday}
        totalPayable={totalPayable}
        totalFines={totalFines}
        recentAttendances={todayAttendances}
        employeeStatuses={JSON.parse(JSON.stringify(employeeStatuses))}
        dayOffLabel={holidayName ? `Holiday — ${holidayName}` : isWeekend ? "Sunday" : null}
      />
    );
  }

  // Employee dashboard — ALL queries in ONE batch (no sequential queries)
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  const [
    todayAttendance,
    leaveBalance,
    currentPayroll,
    recentFines,
    recentIncentives,
    announcements,
    leaveRequests,
    monthAttendances,
    salaryStructure,
    currentUser,
    officeSettings,
  ] = await Promise.all([
    prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    }),
    prisma.leaveBalance.findUnique({
      where: { userId_year: { userId, year } },
    }),
    prisma.payrollRecord.findFirst({
      where: { userId, month, year },
    }),
    prisma.fine.findMany({
      where: { userId, month, year },
      orderBy: { createdAt: "desc" },
    }),
    prisma.incentive.findMany({
      where: { userId, month, year },
      orderBy: { createdAt: "desc" },
    }),
    prisma.announcement.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true, title: true, content: true, priority: true, createdAt: true,
        author: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // Monthly attendance — fetched in SAME batch instead of sequentially
    prisma.attendance.findMany({
      where: { userId, date: { gte: startOfMonth, lte: endOfMonth } },
      select: { status: true, workedMinutes: true },
    }),
    prisma.salaryStructure.findUnique({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, status: true, employeeId: true },
    }),
    getCachedSettings(),
  ]);

  const monthPresent = monthAttendances.filter(
    (a) => a.status === "PRESENT" || a.status === "LATE"
  ).length;
  const monthAbsent = monthAttendances.filter((a) => a.status === "ABSENT").length;
  const monthLate = monthAttendances.filter((a) => a.status === "LATE").length;
  const totalWorkedHours = Math.round(
    monthAttendances.reduce((sum, a) => sum + (a.workedMinutes || 0), 0) / 60
  );

  return (
    <EmployeeDashboard
      employeeName={currentUser ? `${currentUser.firstName} ${currentUser.lastName || ""}`.trim() : ""}
      employeeId={currentUser?.employeeId || ""}
      employeeStatus={String(currentUser?.status || "HIRED")}
      todayAttendance={todayAttendance}
      leaveBalance={leaveBalance}
      currentPayroll={currentPayroll}
      recentFines={recentFines}
      recentIncentives={recentIncentives}
      announcements={announcements}
      monthPresent={monthPresent}
      monthAbsent={monthAbsent}
      monthLate={monthLate}
      totalWorkedHours={totalWorkedHours}
      monthlySalary={salaryStructure?.monthlySalary || 0}
      leaveRequests={JSON.parse(JSON.stringify(leaveRequests))}
      workStartTime={officeSettings?.workStartTime || "11:00"}
      breakStartTime={officeSettings?.breakStartTime || "14:00"}
      breakEndTime={officeSettings?.breakEndTime || "15:00"}
      workEndTime={officeSettings?.workEndTime || "19:00"}
    />
  );
}
