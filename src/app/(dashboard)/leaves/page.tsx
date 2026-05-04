import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { LeavesView } from "@/components/leaves/leaves-view";

export const dynamic = "force-dynamic";

export default async function LeavesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";
  const isPartner = role === "PARTNER";
  // CEO + Partner share the manager view (table of team leaves + Approve/Reject).
  // Employees still see only their own.
  const isManagerView = isAdmin || isPartner;

  // Resolve PARTNER scope: their team's user ids.
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

  const where: any = {};
  if (isPartner) {
    // Partners see leave requests from their team only
    where.userId =
      partnerMemberIds && partnerMemberIds.length > 0
        ? { in: partnerMemberIds }
        : "__none__";
  } else if (!isAdmin) {
    // Regular employees see their own
    where.userId = session.user.id;
  }

  const [leaves, balance] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        approver: { select: { firstName: true, lastName: true } },
      },
      // Sort by leave month (newest first) then by createdAt within each month.
      // Cleanup cron already prunes anything older than 3 months, so this view
      // naturally shows at most the last 3 months.
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    }),
    // Personal leave balance — only relevant for employees viewing their own page.
    // Partners and CEO don't take leaves, so we skip this for the manager view.
    isManagerView
      ? Promise.resolve(null)
      : prisma.leaveBalance.findUnique({
          where: {
            userId_year: {
              userId: session.user.id,
              year: new Date(Date.now() + 5 * 60 * 60_000).getUTCFullYear(),
            },
          },
        }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Management"
        description={
          isAdmin
            ? "Manage employee leave requests"
            : isPartner
            ? "Manage your team's leave requests"
            : "Apply and track your leaves"
        }
      />
      <LeavesView
        leaves={JSON.parse(JSON.stringify(leaves))}
        balance={balance ? JSON.parse(JSON.stringify(balance)) : null}
        isAdmin={isManagerView}
        userId={session.user.id}
      />
    </div>
  );
}
