import { auth } from "@/lib/auth";
import { prisma, getCachedSettings } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { todayPKT, pktMonth, pktYear } from "@/lib/pkt";

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
    const [totalEmployees, todayAttendances, payrollRecords, fines] = await Promise.all([
      prisma.user.count({ where: { status: { in: ["HIRED", "PROBATION"] } } }),
      prisma.attendance.findMany({
        where: { date: today },
        select: {
          id: true, status: true, checkIn: true, checkOut: true, lateMinutes: true,
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
    ]);

    const presentToday = todayAttendances.filter(
      (a) => a.status === "PRESENT" || a.status === "LATE"
    ).length;
    const lateToday = todayAttendances.filter((a) => a.status === "LATE").length;
    const absentToday = totalEmployees - todayAttendances.filter(
      (a) => a.status !== "ABSENT"
    ).length;
    const totalPayable = payrollRecords.reduce((sum, p) => sum + p.netSalary, 0);
    const totalFines = fines.reduce((sum, f) => sum + f.amount, 0);

    return (
      <AdminDashboard
        totalEmployees={totalEmployees}
        presentToday={presentToday}
        lateToday={lateToday}
        absentToday={absentToday}
        totalPayable={totalPayable}
        totalFines={totalFines}
        recentAttendances={todayAttendances}
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
