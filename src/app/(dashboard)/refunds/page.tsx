import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { RefundsView } from "@/components/refunds/refunds-view";

export const dynamic = "force-dynamic";

/**
 * Refund tracking — scoped per role.
 *
 * Access:
 *  - CEO / HR Admin                   → all refunds (every team), delete, no submit
 *  - Izaan (EM-4, manager)            → all refunds in his team, delete, no submit
 *  - PARTNER (Awais / Mubeen / Zain)  → only their team's refunds, no submit
 *  - Etsy-style employees (EM-, AE-, ME- prefixes, except Izaan EM-4)
 *                                      → own refunds only, submit + delete within window
 *  - Facebook team employees / others → redirected
 */
export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;
  const isAdmin = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";
  const isPartner = user.role === "PARTNER";
  const isManager = user.employeeId === "EM-4";
  const empId: string | undefined = user.employeeId;
  // Etsy-style shop owners — can submit refunds. Excludes Izaan (team lead,
  // doesn't own shops). AE-* and ME-* added post multi-office (May 2026).
  const isEtsyShopOwner =
    typeof empId === "string" &&
    !isManager &&
    (empId.startsWith("EM") || empId.startsWith("AE") || empId.startsWith("ME"));

  // EM-4L (Abdullah) was hired for non-Etsy ecom work and is not part of
  // the Etsy bonus/refund program. Block direct URL access.
  if (empId === "EM-4L") {
    redirect("/dashboard");
  }

  // Allowed viewers: CEO/HR, Izaan, any PARTNER, any Etsy-style employee.
  // FB-team employees (SMM-*) and other roles get bounced.
  if (!isAdmin && !isManager && !isPartner && !isEtsyShopOwner) {
    redirect("/dashboard");
  }

  // For PARTNER, resolve their team's member IDs up front. Empty list means
  // their team has no employees yet — show an empty inbox rather than leaking
  // other teams' refunds.
  let partnerMemberIds: string[] | null = null;
  if (isPartner) {
    const teams = await prisma.team.findMany({
      where: { partnerId: user.id },
      select: { members: { select: { id: true } } },
    });
    partnerMemberIds = teams.flatMap((t) => t.members.map((m) => m.id));
  }

  // canSeeAll = admin/manager (full read across the team).
  // PARTNER also gets a team-wide read but scoped via partnerMemberIds below.
  const canSeeAll = isAdmin || isManager || isPartner;

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 1));

  const where: any = {
    createdAt: { gte: startOfMonth, lt: endOfMonth },
  };
  if (isPartner) {
    where.userId = {
      in: partnerMemberIds && partnerMemberIds.length > 0 ? partnerMemberIds : ["__none__"],
    };
  } else if (!canSeeAll) {
    where.userId = user.id;
  }

  const refunds = await prisma.refund.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Can this user submit a refund? Only Etsy-style shop owners.
  // - CEO / HR / PARTNER can't submit (no shop)
  // - Izaan (manager) can't submit (no shop, he supervises)
  // - Etsy / AE / ME employees can submit
  const canSubmit = isEtsyShopOwner;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description={
          isPartner
            ? "All refunds submitted by your team"
            : canSeeAll
            ? "All refunds submitted by the Etsy team"
            : "Submit and track refunds for your assigned Etsy shops"
        }
      />
      <RefundsView
        initialRefunds={JSON.parse(JSON.stringify(refunds))}
        canSeeAll={canSeeAll}
        // Partners see their team's refunds but the API does NOT authorize
        // partner deletes — separate the two prop semantics so the Delete
        // button doesn't render for partners and trigger 403 toasts.
        canDeleteAny={isAdmin || isManager}
        canSubmit={canSubmit}
        currentUserId={user.id}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
