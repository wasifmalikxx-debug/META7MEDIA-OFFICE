import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { RefundsView } from "@/components/refunds/refunds-view";

export const dynamic = "force-dynamic";

/**
 * Refund tracking for the Etsy team.
 *
 * Access:
 *  - CEO / HR Admin         → all refunds, can delete, cannot submit
 *  - Izaan (EM-4, manager)  → all refunds, can delete, can submit
 *  - Etsy employees (EM-*)  → own refunds only, submit + delete within 15 min
 *  - Facebook team / others → redirected to /dashboard
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
  const isEtsyMember = typeof user.employeeId === "string" && user.employeeId.startsWith("EM");
  const isManager = user.employeeId === "EM-4";
  const canSeeAll = isAdmin || isManager;

  // Only Etsy team + admins may view this page
  if (!isEtsyMember && !isAdmin) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 1));

  const where: any = {
    createdAt: { gte: startOfMonth, lt: endOfMonth },
  };
  if (!canSeeAll) {
    where.userId = user.id;
  }

  const refunds = await prisma.refund.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Can this user submit a refund? Only Etsy employees who own shops.
  // - CEO can't submit (no shop)
  // - Izaan (manager) can't submit (no shop, he supervises)
  // - Regular Etsy employees (EM-1, EM-2, ...) can submit
  const canSubmit = isEtsyMember && !isManager;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description={
          canSeeAll
            ? "All refunds submitted by the Etsy team"
            : "Submit and track refunds for your assigned Etsy shops"
        }
      />
      <RefundsView
        initialRefunds={JSON.parse(JSON.stringify(refunds))}
        canSeeAll={canSeeAll}
        canSubmit={canSubmit}
        currentUserId={user.id}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
