import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userRole = (session.user as any).role;
  const userId = session.user.id;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  if (userRole === "SUPER_ADMIN" || userRole === "HR_ADMIN") {
    // Admin dashboard data
    const [
      totalEmployees,
      todayAttendances,
      pendingLeaves,
      announcements,
    ] = await Promise.all([
      prisma.user.count({ where: { status: { in: ["HIRED", "PROBATION"] } } }),
      prisma.attendance.findMany({
        where: { date: today },
        include: { user: { select: { firstName: true, lastName: true, employeeId: true } } },
      }),
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      prisma.announcement.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { author: { select: { firstName: true, lastName: true } } },
      }),
    ]);

    const presentToday = todayAttendances.filter(
      (a) => a.status === "PRESENT" || a.status === "LATE"
    ).length;
    const lateToday = todayAttendances.filter((a) => a.status === "LATE").length;
    const absentToday = totalEmployees - todayAttendances.filter(
      (a) => a.status !== "ABSENT"
    ).length;
    const onLeaveToday = todayAttendances.filter(
      (a) => a.status === "ON_LEAVE"
    ).length;

    // Payroll summary for current month
    const payrollRecords = await prisma.payrollRecord.findMany({
      where: { month, year },
    });
    const totalPayable = payrollRecords.reduce((sum, p) => sum + p.netSalary, 0);
    const totalFines = payrollRecords.reduce((sum, p) => sum + p.totalFines, 0);
    const totalIncentives = payrollRecords.reduce((sum, p) => sum + p.totalIncentives, 0);

    return (
      <AdminDashboard
        totalEmployees={totalEmployees}
        presentToday={presentToday}
        lateToday={lateToday}
        absentToday={absentToday}
        onLeaveToday={onLeaveToday}
        pendingLeaves={pendingLeaves}
        totalPayable={totalPayable}
        totalFines={totalFines}
        totalIncentives={totalIncentives}
        announcements={announcements}
        recentAttendances={todayAttendances}
      />
    );
  }

  // Employee dashboard data
  const [
    todayAttendance,
    leaveBalance,
    currentPayroll,
    recentFines,
    recentIncentives,
    announcements,
    leaveRequests,
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
      include: { author: { select: { firstName: true, lastName: true } } },
    }),
    prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  // Get attendance summary for this month
  const monthAttendances = await prisma.attendance.findMany({
    where: {
      userId,
      date: { gte: new Date(year, month - 1, 1), lte: new Date(year, month, 0) },
    },
  });
  const monthPresent = monthAttendances.filter(
    (a) => a.status === "PRESENT" || a.status === "LATE"
  ).length;
  const monthAbsent = monthAttendances.filter((a) => a.status === "ABSENT").length;
  const monthLate = monthAttendances.filter((a) => a.status === "LATE").length;
  const totalWorkedHours = Math.round(
    monthAttendances.reduce((sum, a) => sum + (a.workedMinutes || 0), 0) / 60
  );

  const [salaryStructure, currentUser, officeSettings] = await Promise.all([
    prisma.salaryStructure.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }),
    prisma.officeSettings.findUnique({ where: { id: "default" } }),
  ]);

  return (
    <EmployeeDashboard
      employeeName={currentUser ? `${currentUser.firstName} ${currentUser.lastName || ""}`.trim() : ""}
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
      breakStartTime={officeSettings?.breakStartTime || "14:00"}
      breakEndTime={officeSettings?.breakEndTime || "15:00"}
      workEndTime={officeSettings?.workEndTime || "19:00"}
    />
  );
}
