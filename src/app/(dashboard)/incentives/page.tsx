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
  const isAdmin = role === "SUPER_ADMIN";
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = _pkt.getUTCMonth() + 1;
  const year = _pkt.getUTCFullYear();

  const where: any = { month, year };
  if (!isAdmin) where.userId = session.user.id;

  const [incentives, employees] = await Promise.all([
    prisma.incentive.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        givenBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    isAdmin
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
        isAdmin={isAdmin}
      />
    </div>
  );
}
