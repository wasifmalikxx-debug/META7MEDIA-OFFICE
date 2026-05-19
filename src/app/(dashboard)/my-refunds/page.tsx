import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { RefundsView } from "@/components/refunds/refunds-view";

export const dynamic = "force-dynamic";

/**
 * /my-refunds — personal refund submission page.
 *
 * Built for users who manage a team AND own shops (today: Izaan, EM-4).
 * Regular EM-/AE-/ME- shop-owner employees submit at /refunds (since
 * they don't have a manager-style team view there). Izaan needs both
 * surfaces, so the CEO asked for them as separate sidebar items
 * instead of one mashed-up page.
 *
 * Access:
 *  - SUPER_ADMIN, HR_ADMIN, PARTNER → redirect to /refunds (they don't
 *    own shops, no personal submit needed)
 *  - Izaan (MANAGER + EM-4)        → this page
 *  - Anyone else                    → redirect to /refunds (their
 *    employee submit view already lives there)
 *
 * Renders the same RefundsView employees use, scoped to the caller's
 * own user id so they only see their own submissions.
 */
export default async function MyRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as { id: string; role: string; employeeId?: string };

  // Only Izaan (and any future shop-owning manager) lands here. Everyone
  // else gets bounced to the appropriate existing surface.
  const isIzaan = user.role === "MANAGER" && user.employeeId === "EM-4";
  if (!isIzaan) {
    redirect("/refunds");
  }

  const params = await searchParams;
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 1));

  // Two-query approach mirrors /refunds so the proof-image lazy-load
  // pattern keeps working. We project the same fields here.
  const [refundsList, refundsWithProof] = await Promise.all([
    prisma.refund.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: startOfMonth, lt: endOfMonth },
      },
      select: {
        id: true,
        userId: true,
        storeName: true,
        customerName: true,
        etsyRefundAmount: true,
        aliexpressRefunded: true,
        aliexpressAmount: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.refund.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: startOfMonth, lt: endOfMonth },
        aliexpressProofUrl: { not: null },
      },
      select: { id: true },
    }),
  ]);
  const proofIds = new Set(refundsWithProof.map((r) => r.id));
  const refunds = refundsList.map((r) => ({
    ...r,
    hasProof: proofIds.has(r.id),
    aliexpressProofUrl: null as string | null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submit Refund"
        description="Submit and track refunds for your own shops. Your team's refunds live on the Refunds page."
      />
      <RefundsView
        key={`my-refunds-${year}-${month}`}
        initialRefunds={JSON.parse(JSON.stringify(refunds))}
        // canSeeAll=false → renders as the personal list (no Employee column,
        // no aggregate stats). canDeleteAny=false → no admin-delete; Izaan
        // can still delete his own inside the 15-min owner window.
        canSeeAll={false}
        canDeleteAny={false}
        canSubmit={true}
        currentUserId={user.id}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
