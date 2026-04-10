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
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const endOfMonth = new Date(Date.UTC(year, month, 0));

    const [
      allEmployees, todayAttendances, payrollRecords, fines, todayLeaves,
      officeSettings, todayHoliday, monthAttendances, todayReports,
      monthFinesDetailed,
      // CEO Command Center — pending action counts
      pendingLeavesCount, pendingDevicesCount, pendingReviewBonusesCount, complaintsAwaitingCeoCount,
    ] = await Promise.all([
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
      // Monthly attendance for chart
      prisma.attendance.findMany({
        where: { date: { gte: startOfMonth, lte: endOfMonth } },
        select: { date: true, status: true, userId: true },
      }),
      // Today's daily reports count
      prisma.dailyReport.count({ where: { date: today } }),
      // Monthly fines with dates for chart
      prisma.fine.findMany({
        where: { month, year },
        select: { date: true, amount: true, type: true },
      }),
      // Command Center — pending counts (cheap aggregate queries)
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      prisma.deviceApproval.count({ where: { status: "PENDING" } }),
      prisma.reviewBonus.count({ where: { status: "PENDING" } }),
      prisma.complaint.count({ where: { unreadByCeo: true, status: { notIn: ["RESOLVED", "DENIED"] } } }),
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

    // Build attendance trend data (per day of month)
    const daysInMonth = new Date(year, month, 0).getDate();
    const attendanceTrend = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayAtt = monthAttendances.filter((a: any) => a.date.toISOString().split("T")[0] === dateStr);
      const present = dayAtt.filter((a: any) => a.status === "PRESENT" || a.status === "LATE").length;
      const absent = dayAtt.filter((a: any) => a.status === "ABSENT").length;
      return { day: String(day), present, absent };
    });

    // Build fines trend data (per day)
    const finesTrend = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayFines = monthFinesDetailed.filter((f: any) => f.date?.toISOString().split("T")[0] === dateStr);
      const total = dayFines.reduce((s: number, f: any) => s + f.amount, 0);
      return { day: String(day), fines: total };
    });

    // Top absent employees
    const absentCounts: Record<string, { name: string; employeeId: string; count: number }> = {};
    monthAttendances.filter((a: any) => a.status === "ABSENT").forEach((a: any) => {
      if (!absentCounts[a.userId]) {
        const emp = allEmployees.find((e) => e.id === a.userId);
        absentCounts[a.userId] = { name: emp ? `${emp.firstName} ${emp.lastName || ""}`.trim() : "Unknown", employeeId: emp?.employeeId || "", count: 0 };
      }
      absentCounts[a.userId].count++;
    });
    const topAbsent = Object.values(absentCounts).sort((a, b) => b.count - a.count).slice(0, 5);

    // Team productivity
    const etsyEmployees = allEmployees.filter((e) => e.employeeId.startsWith("EM"));
    const fbEmployees = allEmployees.filter((e) => e.employeeId.startsWith("SMM"));
    const etsyPresent = monthAttendances.filter((a: any) => (a.status === "PRESENT" || a.status === "LATE") && etsyEmployees.some((e) => e.id === a.userId)).length;
    const fbPresent = monthAttendances.filter((a: any) => (a.status === "PRESENT" || a.status === "LATE") && fbEmployees.some((e) => e.id === a.userId)).length;

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
        attendanceTrend={attendanceTrend}
        finesTrend={finesTrend}
        todayReports={todayReports}
        topAbsent={topAbsent}
        etsyTeamSize={etsyEmployees.length}
        fbTeamSize={fbEmployees.length}
        etsyPresent={etsyPresent}
        fbPresent={fbPresent}
        commandCenter={{
          pendingLeaves: pendingLeavesCount,
          pendingDevices: pendingDevicesCount,
          pendingReviewBonuses: pendingReviewBonusesCount,
          complaintsAwaitingReply: complaintsAwaitingCeoCount,
        }}
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
    empOfficeSettings,
    empHoliday,
    todayReport,
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
      select: { date: true, status: true, workedMinutes: true },
    }),
    prisma.salaryStructure.findUnique({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, status: true, employeeId: true },
    }),
    getCachedSettings(),
    prisma.officeSettings.findUnique({ where: { id: "default" }, select: { weekendDays: true } }),
    prisma.holiday.findFirst({ where: { date: today } }),
    prisma.dailyReport.findUnique({ where: { userId_date: { userId, date: today } } }),
  ]);

  // Detect weekend/holiday for employee
  const empDayOfWeek = nowPKT().getUTCDay();
  const empWeekendDays = (empOfficeSettings?.weekendDays || "0").split(",").map((d: string) => parseInt(d.trim()));
  const empIsDayOff = empWeekendDays.includes(empDayOfWeek) || !!empHoliday;
  const empDayOffLabel = empHoliday?.name ? `Holiday — ${empHoliday.name}` : empWeekendDays.includes(empDayOfWeek) ? "Sunday — Day Off" : null;

  // Live break-skip fine check — runs only AFTER the break window has closed
  // (quick PKT-time gate skips this entirely during most of the day to avoid
  // unnecessary DB queries).
  if (
    todayAttendance?.checkIn &&
    !todayAttendance?.checkOut &&
    !todayAttendance?.breakStart &&
    !empIsDayOff
  ) {
    // Fast PKT check: is the break window already closed?
    const { pktMinutesSinceMidnight } = await import("@/lib/pkt");
    const isFriday = nowPKT().getUTCDay() === 5;
    const breakEndStr = isFriday
      ? (officeSettings?.fridayBreakEndTime || "14:45")
      : (officeSettings?.breakEndTime || "16:00");
    const [beH, beM] = breakEndStr.split(":").map(Number);
    const breakEndMin = beH * 60 + beM + (officeSettings?.breakGraceMinutes || 0);
    const currentPktMin = pktMinutesSinceMidnight();
    // Only run the full check if the break window has closed (saves ~2 DB queries per page load otherwise)
    if (currentPktMin >= breakEndMin) {
      try {
        const { maybeCreateBreakSkipFine } = await import("@/lib/services/break-fine");
        const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
        if (admin) {
          const workedMs = nowPKT().getTime() - todayAttendance.checkIn.getTime();
          const workedMinutes = Math.max(0, Math.floor(workedMs / 60000));
          await maybeCreateBreakSkipFine({
            userId,
            date: today,
            breakStart: todayAttendance.breakStart,
            checkIn: todayAttendance.checkIn,
            checkOut: null,
            workedMinutes,
            adminId: admin.id,
          });
        }
      } catch (e) {
        console.warn("[dashboard] Live break-skip fine check failed:", e);
      }
    }
  }

  // Calculate accumulated leave budget (rollover)
  const { getAccumulatedLeaveBudget } = await import("@/lib/services/leave-budget.service");
  const leaveBudgetInfo = await getAccumulatedLeaveBudget(userId, officeSettings?.paidLeavesPerMonth ?? 1);

  const monthPresent = monthAttendances.filter(
    (a) => a.status === "PRESENT" || a.status === "LATE"
  ).length;
  const monthAbsent = monthAttendances.filter((a) => a.status === "ABSENT").length;
  const monthLate = monthAttendances.filter((a) => a.status === "LATE").length;
  const monthHalfDay = monthAttendances.filter((a) => a.status === "HALF_DAY").length;
  const totalWorkedMin = monthAttendances.reduce((sum, a) => sum + (a.workedMinutes || 0), 0);
  const totalWorkedHours = Math.round(totalWorkedMin / 60);

  // Working days so far (exclude weekends/holidays)
  const pktToday = nowPKT();
  const todayDate = pktToday.getUTCDate();
  const wkDays = (empOfficeSettings?.weekendDays || "0").split(",").map((d: string) => parseInt(d.trim()));
  let workingDaysSoFar = 0;
  for (let d = 1; d <= todayDate; d++) {
    const dayOfWeek = new Date(year, month - 1, d).getDay();
    if (!wkDays.includes(dayOfWeek)) workingDaysSoFar++;
  }
  const attendanceRate = workingDaysSoFar > 0 ? Math.round((monthPresent / workingDaysSoFar) * 100) : 100;

  // This week attendance (Sat-Fri or Mon-Sat)
  const weekAttendances = monthAttendances
    .filter((a) => {
      const attDate = new Date(a.date);
      const diffDays = Math.floor((today.getTime() - attDate.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays < 7;
    })
    .map((a) => ({ date: a.date, status: a.status }));

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
      breakStartTime={nowPKT().getUTCDay() === 5 ? (officeSettings?.fridayBreakStartTime || "13:30") : (officeSettings?.breakStartTime || "15:00")}
      breakEndTime={nowPKT().getUTCDay() === 5 ? (officeSettings?.fridayBreakEndTime || "14:45") : (officeSettings?.breakEndTime || "16:00")}
      workEndTime={officeSettings?.workEndTime || "19:00"}
      isDayOff={empIsDayOff}
      dayOffLabel={empDayOffLabel}
      hasSubmittedReport={!!todayReport}
      pendingLeaves={leaveBudgetInfo.available}
      attendanceRate={attendanceRate}
      monthHalfDay={monthHalfDay}
      totalWorkedMin={totalWorkedMin}
      weekAttendances={JSON.parse(JSON.stringify(weekAttendances))}
    />
  );
}
