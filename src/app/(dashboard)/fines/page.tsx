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
  const isPartner = role === "PARTNER";
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  // Resolve scope for PARTNER → list of user ids on the partner's team(s).
  // CEO sees all (no filter), employees see self.
  let scopedUserIds: string[] | null = null;
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
    scopedUserIds = teams.flatMap((t) => t.members.map((m) => m.id));
    console.log(`[fines page] partner=${session.user.id} teams=${teams.length} scopedUserIds=${scopedUserIds.length}`);
  }
  console.log(`[fines page] role=${role} isPartner=${isPartner} month=${month} year=${year}`);

  // Build the userId filter that applies to fines / attendance / leaves.
  // For partners with empty teams, force "no rows" via a non-existent id.
  const partnerUserFilter =
    scopedUserIds && scopedUserIds.length > 0 ? { in: scopedUserIds } : "__none__";

  const where: any = { month, year };
  if (isPartner) where.userId = partnerUserFilter;
  else if (!isAdmin) where.userId = session.user.id;

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  const attWhere: any = { date: { gte: startOfMonth, lte: endOfMonth } };
  const leaveWhere: any = { startDate: { gte: startOfMonth, lte: endOfMonth } };
  if (isPartner) {
    attWhere.userId = partnerUserFilter;
    leaveWhere.userId = partnerUserFilter;
  } else if (!isAdmin) {
    attWhere.userId = session.user.id;
    leaveWhere.userId = session.user.id;
  }

  // Treat PARTNER like the admin view of FinesView (employee filter dropdown,
  // team-wide stats), since they're managing their team's daily activities.
  const isManagerView = isAdmin || isPartner;

  const [fines, employees, attendances, leaves] = await Promise.all([
    prisma.fine.findMany({
      where,
      include: {
        // Multi-office: team label tells the CEO at-a-glance whose team a
        // fine belongs to (e.g. "Awais Team" / "Mubeen Team" / "Etsy - EM").
        user: {
          select: {
            firstName: true,
            lastName: true,
            employeeId: true,
            team: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
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
      : isPartner && scopedUserIds && scopedUserIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: scopedUserIds } },
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
        user: {
          select: {
            firstName: true,
            lastName: true,
            employeeId: true,
            team: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
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
        isAdmin={isManagerView}
        currentMonth={month}
        currentYear={year}
        attendances={JSON.parse(JSON.stringify(attendances))}
        leaves={JSON.parse(JSON.stringify(leaves))}
      />
    </div>
  );
}
