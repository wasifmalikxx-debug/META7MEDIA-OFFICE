import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { AttendanceView } from "@/components/attendance/attendance-view";
import { pktMonth, pktYear, startOfMonthPKT, endOfMonthPKT } from "@/lib/pkt";

export default async function AttendancePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";

  const month = pktMonth();
  const year = pktYear();
  const startDate = startOfMonthPKT();
  const endDate = endOfMonthPKT();

  let attendances;
  let employees: any[] = [];

  if (isAdmin) {
    attendances = await prisma.attendance.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
      orderBy: { date: "desc" },
    });
    employees = await prisma.user.findMany({
      where: { status: { in: ["HIRED", "PROBATION"] } },
      select: { id: true, firstName: true, lastName: true, employeeId: true },
      orderBy: { firstName: "asc" },
    });
  } else {
    attendances = await prisma.attendance.findMany({
      where: {
        userId: session.user.id,
        date: { gte: startDate, lte: endDate },
      },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
      orderBy: { date: "desc" },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description={isAdmin ? "View and manage employee attendance" : "Your attendance history"}
      />
      <AttendanceView
        attendances={JSON.parse(JSON.stringify(attendances))}
        employees={employees}
        isAdmin={isAdmin}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
