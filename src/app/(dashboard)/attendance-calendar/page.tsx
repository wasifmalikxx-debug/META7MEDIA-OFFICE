import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { AttendanceCalendarView } from "@/components/attendance/attendance-calendar-view";
import { autoHealBogusCheckouts } from "@/lib/services/auto-heal-bogus-checkouts";

export const dynamic = "force-dynamic";

export default async function AttendanceCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  // Partners also access this page — scoped to their team(s) below.
  if (role !== "SUPER_ADMIN" && role !== "PARTNER") redirect("/dashboard");
  const isPartner = role === "PARTNER";

  // SELF-HEAL: revert bogus auto-checkout records (recurring Vercel stale-build bug).
  await autoHealBogusCheckouts().catch((e) => console.warn("[auto-heal]", e));

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  // Resolve PARTNER's team member ids; CEO sees everyone.
  let partnerMemberIds: string[] | null = null;
  if (isPartner) {
    const teams = await prisma.team.findMany({
      where: { partnerId: session.user.id },
      select: {
        members: {
          where: { status: { in: ["HIRED", "PROBATION"] } },
          select: { id: true },
        },
      },
    });
    partnerMemberIds = teams.flatMap((t) => t.members.map((m) => m.id));
  }
  console.log(`[calendar] role=${role} isPartner=${isPartner} partnerMemberIds=${partnerMemberIds?.length ?? "n/a"}`);

  // Where-clause fragments scoped to partner's team (or unrestricted for CEO).
  const empWhere: any = isPartner
    ? (partnerMemberIds && partnerMemberIds.length > 0
        ? { id: { in: partnerMemberIds } }
        : { id: "__none__" })
    : { role: { not: "SUPER_ADMIN" as const } };

  const userIdScope: any = isPartner
    ? (partnerMemberIds && partnerMemberIds.length > 0
        ? { in: partnerMemberIds }
        : "__none__")
    : undefined;

  console.log(`[calendar] empWhere=${JSON.stringify(empWhere)} userIdScope=${JSON.stringify(userIdScope)}`);
  const [employees, attendances, holidays, settings, monthCoveredFines] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: { in: ["HIRED", "PROBATION"] },
        // PARTNER rows are not employees — exclude them from the calendar
        // even on the CEO view (otherwise Zain/Awais/Mubeen would render
        // empty calendar grids).
        role: { notIn: ["SUPER_ADMIN", "PARTNER"] },
        ...empWhere,
      },
      select: {
        id: true, firstName: true, lastName: true, employeeId: true, status: true,
        // Multi-office grouping: use team if present, fall back to department.
        // The view groups employees under team headers in the CEO calendar.
        team: {
          select: {
            id: true,
            name: true,
            partner: { select: { firstName: true, lastName: true } },
          },
        },
        department: { select: { id: true, name: true } },
        office: { select: { id: true, name: true } },
      },
      orderBy: { employeeId: "asc" },
    }),
    prisma.attendance.findMany({
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        ...(userIdScope ? { userId: userIdScope } : {}),
      },
      select: {
        userId: true, date: true, status: true, checkIn: true, checkOut: true,
        workedMinutes: true, lateMinutes: true,
      },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: startOfMonth, lte: endOfMonth } },
      select: { date: true, name: true },
    }),
    // Phase 3: settings are per-office. Reads the viewer's own office row.
    prisma.officeSettings.findFirst({
      where: { office: { users: { some: { id: session.user.id } } } },
      select: { weekendDays: true, paidLeavesPerMonth: true },
    }),
    // Per-date covered fines for the month — marks covered absents with "C"
    prisma.fine.findMany({
      where: {
        amount: 0,
        type: "ABSENT_WITHOUT_LEAVE",
        reason: { contains: "Covered by paid leave" },
        date: { gte: startOfMonth, lte: endOfMonth },
        ...(userIdScope ? { userId: userIdScope } : {}),
      },
      select: { userId: true, date: true },
    }),
  ]);

  // Build a Set of "userId|YYYY-MM-DD" for fast covered-lookup
  const coveredSet = new Set<string>();
  for (const f of monthCoveredFines) {
    coveredSet.add(`${f.userId}|${f.date.toISOString().split("T")[0]}`);
  }

  // ── Per-employee leave balance (canonical rule, per leave-budget.service) ──
  // Every month each employee earns paidLeavesPerMonth (default 1.0) — no
  // rollover. ONLY explicit half-day leave applications consume the displayed
  // budget (half-day = 0.5). Auto-paid absences use a separate per-month
  // allowance and do NOT subtract here.
  //
  // Pre-fix this page used a months-since-SYS_START × 1.0 formula that
  // (a) inflated balances for new hires (e.g. ME-1 joined May 4 was showing
  // 2.0 instead of 1.0) and (b) double-counted absent fines that should have
  // gone through their own auto-cover allowance, not the half-day budget.
  // Both were drift from the canonical rule. Now matches leave-budget.service.
  const empIds = employees.map((e) => e.id);
  const paidLeavesPerMonth = settings?.paidLeavesPerMonth ?? 1;

  // Half-day applications IN THE CURRENTLY-VIEWED MONTH only.
  const monthHalfDayLeaves = await prisma.leaveRequest.groupBy({
    by: ["userId"],
    where: {
      userId: { in: empIds },
      leaveType: "HALF_DAY",
      status: "APPROVED",
      startDate: { gte: startOfMonth, lte: endOfMonth },
    },
    _count: true,
  });

  const halfDayMap: Record<string, number> = {};
  monthHalfDayLeaves.forEach((a: any) => { halfDayMap[a.userId] = a._count; });

  const leaveBudgets: Record<string, number> = {};
  for (const emp of employees) {
    const used = (halfDayMap[emp.id] || 0) * 0.5;
    leaveBudgets[emp.id] = Math.max(0, paidLeavesPerMonth - used);
  }

  // Build attendance map: userId -> { "YYYY-MM-DD": status data }
  const attendanceMap: Record<string, Record<string, any>> = {};
  for (const att of attendances) {
    const dateKey = att.date.toISOString().split("T")[0];
    if (!attendanceMap[att.userId]) attendanceMap[att.userId] = {};
    const covered = coveredSet.has(`${att.userId}|${dateKey}`);
    attendanceMap[att.userId][dateKey] = {
      status: att.status,
      checkIn: att.checkIn,
      checkOut: att.checkOut,
      workedMinutes: att.workedMinutes,
      lateMinutes: att.lateMinutes,
      covered, // true if this absent was covered by paid leave
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
