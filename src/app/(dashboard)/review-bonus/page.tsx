import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { ReviewBonusSubmit } from "@/components/review-bonus/review-bonus-submit";
import { ReviewBonusManager } from "@/components/review-bonus/review-bonus-manager";
import { resolveEtsyScope } from "@/lib/etsy-team-scope";

export const dynamic = "force-dynamic";

export default async function ReviewBonusPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string; team?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const role = (session.user as any).role;
  const userId = session.user.id;
  const employeeId = (session.user as any).employeeId;
  // CEO + MANAGER (Izaan) + PARTNER (Awais, Mubeen, Zain) all see an approval
  // inbox. PARTNERs are scoped to their own team's submissions only.
  const isReviewer = role === "SUPER_ADMIN" || role === "MANAGER" || role === "PARTNER";
  // Izaan (EM-4) now runs his own shops (May 19 2026) so he ALSO needs the
  // employee-style submit form alongside his approval inbox. The submit
  // form is added inline below the inbox for him only. CEO/HR/Partners
  // don't get a submit form (they don't own shops). The self-approval
  // guard in the PATCH API stops Izaan from approving his own claims —
  // CEO handles those.
  const showOwnSubmit = role === "MANAGER" && employeeId === "EM-4";

  // EM-4L (Abdullah) was hired for non-Etsy ecom work and is not part of
  // the Etsy bonus program. Block direct URL access.
  if (employeeId === "EM-4L") redirect("/dashboard");

  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  if (isReviewer) {
    // Scope rules:
    //   PARTNER → only their team's submissions (already in place)
    //   MANAGER (Izaan) → only employees in his own department (Etsy - EM).
    //   SUPER_ADMIN (CEO) → defaults to everything; ?team=em|ae|me filters
    //     to that one team's submissions (used by per-partner sidebar links).
    let userIdFilter: { in: string[] } | undefined;
    let userRelationFilter: { departmentId: string } | undefined;
    let scopedTeamName: string | null = null;
    if (role === "PARTNER") {
      const teams = await prisma.team.findMany({
        where: { partnerId: userId },
        select: { members: { select: { id: true } } },
      });
      const memberIds = teams.flatMap((t) => t.members.map((m) => m.id));
      // Empty-set filter: if partner has no team members, surface an empty
      // inbox rather than leaking everyone else's submissions.
      userIdFilter = { in: memberIds.length > 0 ? memberIds : ["__none__"] };
    } else if (role === "MANAGER") {
      // Look up the manager's own department and use a relation filter so
      // only submissions from employees in that department surface.
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { departmentId: true },
      });
      if (me?.departmentId) {
        userRelationFilter = { departmentId: me.departmentId };
      } else {
        // Manager somehow has no department — show an empty inbox rather
        // than leaking everything.
        userIdFilter = { in: ["__none__"] };
      }
    } else if (role === "SUPER_ADMIN" && params.team) {
      const scope = await resolveEtsyScope(role, userId, params.team);
      if (scope) {
        userRelationFilter = { departmentId: scope.departmentId };
        scopedTeamName = scope.departmentName;
      }
    }

    const submissions = await prisma.reviewBonus.findMany({
      where: {
        month,
        year,
        ...(userIdFilter ? { userId: userIdFilter } : {}),
        ...(userRelationFilter ? { user: userRelationFilter } : {}),
        // In Izaan's dual-view, drop his own claims from the team inbox so
        // they only appear in his personal "My Review Claims" section
        // below. He can't approve them anyway (self-approval guard); the
        // CEO sees + approves them via the SUPER_ADMIN branch. Without
        // this filter the same claim would render twice on Izaan's page —
        // once with a disabled "Approve" button and once in his own list.
        ...(showOwnSubmit ? { NOT: { userId } } : {}),
      },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Izaan also gets his OWN submit form — fetch his personal submissions
    // for the current month so the form can list/edit them just like an
    // employee's view. CEO/Partners don't render this section.
    let ownSubmissions: typeof submissions = [];
    if (showOwnSubmit) {
      ownSubmissions = await prisma.reviewBonus.findMany({
        where: { userId, month, year },
        include: {
          user: { select: { firstName: true, lastName: true, employeeId: true } },
          approvedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    return (
      <div className="space-y-6">
        <PageHeader
          title={scopedTeamName ? `${scopedTeamName} — Review Approvals` : "Review Approvals"}
          description={
            role === "PARTNER"
              ? "Approve or reject your team's review bonus submissions"
              : scopedTeamName
              ? `Approve or reject review bonus submissions from ${scopedTeamName}`
              : showOwnSubmit
              ? "Approve your team's submissions in the section below — submit your own shop claims in the section underneath that."
              : "Approve or reject employee review bonus submissions"
          }
        />

        {/* Izaan-only: personal submit form lives at the TOP so he doesn't
            have to scroll past his team's inbox to add his own claim.
            Same component employees use — server-side guards (self-
            approval block + role check) keep him from approving his
            own claims. CEO sees those PENDING items in the main inbox
            below and approves them. */}
        {showOwnSubmit && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight pl-1">
              My Review Claims
              <span className="text-[12px] font-normal text-muted-foreground ml-2">
                · your own shops · CEO approves
              </span>
            </h2>
            <ReviewBonusSubmit
              submissions={JSON.parse(JSON.stringify(ownSubmissions))}
              currentMonth={month}
              currentYear={year}
            />
          </div>
        )}

        {/* Approval inbox — team's PENDING claims, dept-scoped. Header
            only shown in Izaan's dual-view so the divider between "my
            stuff" and "team stuff" is unambiguous. */}
        {showOwnSubmit && (
          <h2 className="text-base font-semibold tracking-tight pl-1 pt-4 border-t border-border/40 mt-6">
            Team Review Claims
            <span className="text-[12px] font-normal text-muted-foreground ml-2">
              · Etsy - EM sellers · awaiting your decision
            </span>
          </h2>
        )}
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
