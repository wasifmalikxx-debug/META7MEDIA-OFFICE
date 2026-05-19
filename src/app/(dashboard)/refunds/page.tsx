import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { RefundsView } from "@/components/refunds/refunds-view";
import { resolveEtsyScope } from "@/lib/etsy-team-scope";

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
  searchParams: Promise<{ month?: string; year?: string; team?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;
  const isAdmin = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";
  const isPartner = user.role === "PARTNER";
  const isManager = user.employeeId === "EM-4";
  const empId: string | undefined = user.employeeId;
  // Etsy-style shop owners — can submit refunds. Includes Izaan (EM-4) as
  // of May 19 2026, when the CEO assigned him his own shops alongside
  // his team-lead role. AE-* and ME-* added post multi-office (May 2026).
  // EM-4L (Abdullah) stays excluded — non-Etsy ecom employee.
  const isEtsyShopOwner =
    typeof empId === "string" &&
    empId !== "EM-4L" &&
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

  // For MANAGER (Izaan), scope to employees in his own department (Etsy - EM).
  // He must NOT see AE-/ME- team refunds. Resolved as a relation filter on
  // the where clause below.
  let managerDepartmentId: string | null = null;
  if (isManager) {
    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { departmentId: true },
    });
    managerDepartmentId = me?.departmentId ?? null;
  }

  // canSeeAll = admin (full read across every team and office).
  // MANAGER + PARTNER get a team-wide read but scoped further below.
  const canSeeAll = isAdmin || isManager || isPartner;

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 1));

  // CEO can scope refunds to one Etsy team via ?team=em|ae|me. No param =
  // see all teams (legacy behavior).
  let scopedTeamName: string | null = null;
  if (isAdmin && params.team) {
    const scope = await resolveEtsyScope("SUPER_ADMIN", user.id, params.team);
    if (scope) {
      scopedTeamName = scope.departmentName;
      // managerDepartmentId reuses the same Prisma relation filter shape below
      managerDepartmentId = scope.departmentId;
    }
  }

  const where: any = {
    createdAt: { gte: startOfMonth, lt: endOfMonth },
  };
  if (isPartner) {
    where.userId = {
      in: partnerMemberIds && partnerMemberIds.length > 0 ? partnerMemberIds : ["__none__"],
    };
  } else if (isManager) {
    if (managerDepartmentId) {
      where.user = { departmentId: managerDepartmentId };
    } else {
      where.userId = { in: ["__none__"] };
    }
  } else if (isAdmin && managerDepartmentId) {
    // CEO with ?team= active — scope to the resolved department.
    where.user = { departmentId: managerDepartmentId };
  } else if (!canSeeAll) {
    where.userId = user.id;
  }

  // Two-query approach to avoid pulling base64 proof images into the list:
  //  1. Main list — explicit `select` that omits aliexpressProofUrl. With
  //     ~30 refunds × ~50KB proof images each, including the URL inflates
  //     the response to ~1MB and the query to 5+ seconds. Omitting it
  //     drops the payload by ~95%.
  //  2. Side query — IDs of refunds that DO have a proof, so the UI can
  //     show a "View Proof" button without the URL itself. The actual URL
  //     is fetched on-demand via GET /api/refunds/[id] when the user
  //     clicks the button.
  const [refundsList, refundsWithProof] = await Promise.all([
    prisma.refund.findMany({
      where,
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
      where: { ...where, aliexpressProofUrl: { not: null } },
      select: { id: true },
    }),
  ]);
  const proofIds = new Set(refundsWithProof.map((r) => r.id));
  const refunds = refundsList.map((r) => ({
    ...r,
    hasProof: proofIds.has(r.id),
    // Kept for backward-compat with the existing client type. Always null
    // in the list payload — the actual URL is lazy-fetched.
    aliexpressProofUrl: null as string | null,
  }));

  // Can this user submit a refund? Only Etsy-style shop owners.
  // - CEO / HR / PARTNER can't submit (no shop)
  // - Izaan (manager) can't submit (no shop, he supervises)
  // - Etsy / AE / ME employees can submit
  const canSubmit = isEtsyShopOwner;

  return (
    <div className="space-y-6">
      <PageHeader
        title={scopedTeamName ? `${scopedTeamName} — Refunds` : "Refunds"}
        description={
          isPartner
            ? "All refunds submitted by your team"
            : scopedTeamName
            ? `All refunds submitted by ${scopedTeamName}`
            : canSeeAll
            ? "All refunds submitted by the Etsy team"
            : "Submit and track refunds for your assigned Etsy shops"
        }
      />
      <RefundsView
        // KEY ON SCOPE — forces a fresh client-side mount when the CEO
        // switches teams (?team=em → ?team=ae) or months. RefundsView
        // initializes its `refunds` state once via `useState(initialRefunds)`,
        // which means a soft re-render with new props leaves the old list
        // stuck on screen. Including team/month/year in the key remounts the
        // component so state re-seeds from the new server payload, and
        // resets transient UI (open dialog, lightbox) that belonged to the
        // previous scope.
        key={`refunds-${params.team ?? "all"}-${year}-${month}`}
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
