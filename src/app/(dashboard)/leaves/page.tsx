import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { LeavesView } from "@/components/leaves/leaves-view";
import { getMonthlyLeaveUsage } from "@/lib/services/leave-budget.service";
import { nowPKT } from "@/lib/pkt";

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

  const where: Record<string, unknown> = {};
  if (isPartner) {
    where.userId =
      partnerMemberIds && partnerMemberIds.length > 0
        ? { in: partnerMemberIds }
        : "__none__";
  } else if (!isAdmin) {
    where.userId = session.user.id;
  }

  // Parallel fetch — leaves, annual balance, monthly unified-pool usage.
  // Monthly usage only for employees (managers don't take leaves themselves).
  const pkt = nowPKT();
  const [leaves, balance, monthlyUsage] = await Promise.all([
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
    // Annual leave balance — only relevant for employees on their own page.
    isManagerView
      ? Promise.resolve(null)
      : prisma.leaveBalance.findUnique({
          where: {
            userId_year: {
              userId: session.user.id,
              year: pkt.getUTCFullYear(),
            },
          },
        }),
    // Monthly unified-pool usage (auto-cover absences + half-day leaves).
    // Same source of truth as the attendance calendar's Bal column.
    isManagerView
      ? Promise.resolve(null)
      : getMonthlyLeaveUsage(session.user.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Management"
        description={
          isAdmin
            ? "Review and manage every team's leave requests"
            : isPartner
            ? "Approve or reject your team's leave requests"
            : "Apply for leave and track your monthly + annual entitlement"
        }
      />
      <LeavesView
        leaves={JSON.parse(JSON.stringify(leaves))}
        balance={balance ? JSON.parse(JSON.stringify(balance)) : null}
        monthlyUsage={monthlyUsage}
        isAdmin={isManagerView}
        userId={session.user.id}
        currentMonth={pkt.getUTCMonth() + 1}
        currentYear={pkt.getUTCFullYear()}
      />
    </div>
  );
}
