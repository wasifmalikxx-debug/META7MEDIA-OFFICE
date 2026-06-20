import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { IncentivesView } from "@/components/incentives-fines/incentives-view";

export const dynamic = "force-dynamic";

export default async function IncentivesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  // M3: HR_ADMIN is CEO-equivalent for the company-wide incentives VIEW (matches
  // the incentives API + the rest of the portal); everyone else sees self only.
  // Creating incentives stays SUPER_ADMIN-only (the POST is requireRole
  // SUPER_ADMIN), so the Add form is gated separately on canManage — no dead
  // button for HR.
  const canViewAll = role === "SUPER_ADMIN" || role === "HR_ADMIN";
  const canManage = role === "SUPER_ADMIN";
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = _pkt.getUTCMonth() + 1;
  const year = _pkt.getUTCFullYear();

  const where: any = { month, year };
  if (!canViewAll) where.userId = session.user.id;

  const [incentives, employees] = await Promise.all([
    prisma.incentive.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        givenBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    canManage
      ? prisma.user.findMany({
          where: { status: { in: ["HIRED", "PROBATION"] } },
          select: { id: true, firstName: true, lastName: true, employeeId: true },
          orderBy: { firstName: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Incentives" description="Manage employee bonuses and incentives" />
      <IncentivesView
        incentives={JSON.parse(JSON.stringify(incentives))}
        employees={employees}
        isAdmin={canManage}
      />
    </div>
  );
}
