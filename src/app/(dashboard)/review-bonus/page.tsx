import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { ReviewBonusSubmit } from "@/components/review-bonus/review-bonus-submit";
import { ReviewBonusManager } from "@/components/review-bonus/review-bonus-manager";

export const dynamic = "force-dynamic";

export default async function ReviewBonusPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const role = (session.user as any).role;
  const userId = session.user.id;
  const employeeId = (session.user as any).employeeId;
  // CEO + MANAGER (Izaan) + PARTNER (Awais, Mubeen, Zain) all see an approval
  // inbox. PARTNERs are scoped to their own team's submissions only.
  const isReviewer = role === "SUPER_ADMIN" || role === "MANAGER" || role === "PARTNER";

  // EM-4L (Abdullah) was hired for non-Etsy ecom work and is not part of
  // the Etsy bonus program. Block direct URL access.
  if (employeeId === "EM-4L") redirect("/dashboard");

  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  if (isReviewer) {
    // PARTNERs see only their team's submissions; CEO/MANAGER see all.
    let userIdFilter: { in: string[] } | undefined;
    if (role === "PARTNER") {
      const teams = await prisma.team.findMany({
        where: { partnerId: userId },
        select: { members: { select: { id: true } } },
      });
      const memberIds = teams.flatMap((t) => t.members.map((m) => m.id));
      // Empty-set filter: if partner has no team members, surface an empty
      // inbox rather than leaking everyone else's submissions.
      userIdFilter = { in: memberIds.length > 0 ? memberIds : ["__none__"] };
    }

    const submissions = await prisma.reviewBonus.findMany({
      where: {
        month,
        year,
        ...(userIdFilter ? { userId: userIdFilter } : {}),
      },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="space-y-6">
        <PageHeader
          title="Review Approvals"
          description={
            role === "PARTNER"
              ? "Approve or reject your team's review bonus submissions"
              : "Approve or reject employee review bonus submissions"
          }
        />
        <ReviewBonusManager
          submissions={JSON.parse(JSON.stringify(submissions))}
          currentMonth={month}
          currentYear={year}
          // PARTNER can approve/reject but not delete — keep the trash button
          // out of their UI to match the API gate.
          canDelete={role !== "PARTNER"}
        />
      </div>
    );
  }

  // Employees see their own submissions for the current PKT month only.
  // The page refreshes automatically at the start of each month — employees
  // start each month with a fresh, empty list and submit new reviews for the
  // new bonus cycle. Past months' records stay in the DB for audit until
  // the cleanup cron eventually purges them.
  const mySubmissions = await prisma.reviewBonus.findMany({
    where: { userId, month, year },
    include: {
      approvedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submit Review"
        description="Submit fixed reviews for Rs. 500 bonus per review"
      />
      <ReviewBonusSubmit
        submissions={JSON.parse(JSON.stringify(mySubmissions))}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
