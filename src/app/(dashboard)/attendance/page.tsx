import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { MyAttendanceCalendar } from "@/components/attendance/my-attendance-calendar";
import { getAccumulatedLeaveBudget } from "@/lib/services/leave-budget.service";

export const dynamic = "force-dynamic";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const userId = session.user.id;

  // CEO goes to the full attendance calendar
  if (role === "SUPER_ADMIN") redirect("/attendance-calendar");

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  const [attendances, settings, holidays, leaveBudget] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId, date: { gte: startOfMonth, lte: endOfMonth } },
      select: {
        date: true, status: true, checkIn: true, checkOut: true,
        workedMinutes: true, lateMinutes: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.officeSettings.findUnique({
      where: { id: "default" },
      select: { weekendDays: true, paidLeavesPerMonth: true },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: startOfMonth, lte: endOfMonth } },
      select: { date: true, name: true },
    }),
    getAccumulatedLeaveBudget(userId, 1),
  ]);

  const weekendDays = (settings?.weekendDays || "0").split(",").map((d: string) => parseInt(d.trim()));
  const holidayMap: Record<string, string> = {};
  holidays.forEach((h) => { holidayMap[h.date.toISOString().split("T")[0]] = h.name; });

  // Stats
  const monthPresent = attendances.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const monthAbsent = attendances.filter((a) => a.status === "ABSENT").length;
  const monthLate = attendances.filter((a) => a.status === "LATE").length;
  const monthHalfDay = attendances.filter((a) => a.status === "HALF_DAY").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Attendance"
        description="Your monthly attendance calendar"
      />
      <MyAttendanceCalendar
        attendances={JSON.parse(JSON.stringify(attendances))}
        holidayMap={holidayMap}
        weekendDays={weekendDays}
        currentMonth={month}
        currentYear={year}
        pendingLeaves={leaveBudget.available}
        monthPresent={monthPresent}
        monthAbsent={monthAbsent}
        monthLate={monthLate}
        monthHalfDay={monthHalfDay}
      />
    </div>
  );
}
