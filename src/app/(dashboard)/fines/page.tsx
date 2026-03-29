import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { FinesView } from "@/components/incentives-fines/fines-view";

export const dynamic = "force-dynamic";

export default async function FinesPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const where: any = { month, year };
  if (!isAdmin) where.userId = session.user.id;

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  const attWhere: any = { date: { gte: startOfMonth, lte: endOfMonth } };
  const leaveWhere: any = { startDate: { gte: startOfMonth, lte: endOfMonth } };
  if (!isAdmin) {
    attWhere.userId = session.user.id;
    leaveWhere.userId = session.user.id;
  }

  const [fines, employees, attendances, leaves] = await Promise.all([
    prisma.fine.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        issuedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    isAdmin
      ? prisma.user.findMany({
          where: { status: { in: ["HIRED", "PROBATION"] }, role: { not: "SUPER_ADMIN" } },
          select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } },
          orderBy: { employeeId: "asc" },
        })
      : Promise.resolve([]),
    prisma.attendance.findMany({
      where: attWhere,
      select: {
        id: true, userId: true, date: true, status: true, checkIn: true, checkOut: true,
        workedMinutes: true, lateMinutes: true,
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.leaveRequest.findMany({
      where: leaveWhere,
      select: {
        id: true, userId: true, leaveType: true, halfDayPeriod: true, startDate: true, endDate: true,
        totalDays: true, reason: true, status: true,
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
      orderBy: { startDate: "desc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Daily Activities" />
      <FinesView
        fines={JSON.parse(JSON.stringify(fines))}
        employees={JSON.parse(JSON.stringify(employees))}
        isAdmin={isAdmin}
        currentMonth={month}
        currentYear={year}
        attendances={JSON.parse(JSON.stringify(attendances))}
        leaves={JSON.parse(JSON.stringify(leaves))}
      />
    </div>
  );
}
