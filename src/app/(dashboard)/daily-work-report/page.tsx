import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { DailyReportView } from "@/components/daily-report/daily-report-view";
import { computeDuplicates } from "@/lib/services/duplicate-listings";

export const dynamic = "force-dynamic";

/**
 * Daily Reports page.
 * Access:
 *  - SUPER_ADMIN (CEO)         → reports filtered by ?team=em|ae|me|fb-hq|fb-o2
 *                                 (no team param = all reports across all teams)
 *  - Izaan (EM-4 team lead)    → EM team reports ONLY (forced; ignores ?team)
 *  - PARTNER (Zain/Awais/Mubeen) → their own team's reports (forced; ignores ?team)
 *  - Everyone else             → redirected to /dashboard
 *
 * Scoping is enforced on the server query, not just the UI, so a partner
 * can never see another team's reports even via a crafted ?team= request.
 */
const TEAM_KEY_TO_DEPT_NAME: Record<string, string> = {
  em: "Etsy - EM",
  ae: "Etsy - AE",
  me: "Etsy - ME",
  "fb-hq": "Facebook - HQ",
  "fb-o2": "Facebook - O2",
};

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string; team?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;
  const role = user.role;
  const isAdmin = role === "SUPER_ADMIN";
  const isEtsyTeamLead = user.employeeId === "EM-4";
  const isPartner = role === "PARTNER";

  if (!isAdmin && !isEtsyTeamLead && !isPartner) {
    redirect("/dashboard");
  }

  // For PARTNER, resolve their team's member IDs up front. Empty list means
  // their team has no employees yet — show an empty inbox rather than leak
  // other teams' reports.
  let partnerMemberIds: string[] | null = null;
  if (isPartner) {
    const teams = await prisma.team.findMany({
      where: { partnerId: user.id },
      select: { members: { select: { id: true } } },
    });
    partnerMemberIds = teams.flatMap((t) => t.members.map((m) => m.id));
  }

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  // Duplicate detection window: last 3 months, ending at the currently-viewed
  // month's end. Matches the cleanup cron's retention — anything older is
  // already pruned, so scanning further back would return nothing.
  const detectionStart = new Date(Date.UTC(year, month - 3, 1));

  // ─── Build the where clause ────────────────────────────────────────
  //
  // Partner / Izaan are pinned to their own scope and ignore ?team= so a
  // crafted URL can't leak. CEO honors ?team= for the new per-team sidebar
  // entry points (Izaan EM / Awais AE / Mubeen ME / Facebook HQ / Zain).
  // For CEO with no team param, show every team mixed (legacy fallback;
  // not normally reachable via the sidebar after this change).
  let baseWhere: any = {};
  let scopedTeamLabel: string | null = null;

  if (isPartner) {
    baseWhere = {
      userId: {
        in: partnerMemberIds && partnerMemberIds.length > 0 ? partnerMemberIds : ["__none__"],
      },
    };
  } else if (isEtsyTeamLead && !isAdmin) {
    baseWhere = { user: { employeeId: { startsWith: "EM" } } };
  } else if (isAdmin && params.team) {
    const deptName = TEAM_KEY_TO_DEPT_NAME[params.team];
    if (deptName) {
      baseWhere = { user: { department: { name: deptName } } };
      scopedTeamLabel = deptName;
    } else {
      // Unknown team key — surface an empty inbox rather than silently
      // showing all teams and breaking the per-team header.
      baseWhere = { userId: { in: ["__none__"] } };
    }
  }

  // Fetch the currently-viewed month for display AND the 3-month detection
  // window for duplicate analysis, in parallel. The detection pool is
  // ordered oldest-first so the first occurrence of each listing ID is
  // correctly identified as the canonical origin.
  const [reports, detectionPool] = await Promise.all([
    prisma.dailyReport.findMany({
      where: { ...baseWhere, date: { gte: startOfMonth, lte: endOfMonth } },
      include: {
        // Multi-office: pull team + dept so the CEO inbox can sub-group each
        // date's reports by team (Awais Team / Mubeen Team / Zain Team /
        // Etsy - EM / Facebook OFFICE 1) instead of one flat list.
        user: {
          select: {
            firstName: true,
            lastName: true,
            employeeId: true,
            team: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { date: "desc" },
    }),
    prisma.dailyReport.findMany({
      where: { ...baseWhere, date: { gte: detectionStart, lte: endOfMonth } },
      include: {
        // Multi-office: pull team + dept so the CEO inbox can sub-group each
        // date's reports by team (Awais Team / Mubeen Team / Zain Team /
        // Etsy - EM / Facebook OFFICE 1) instead of one flat list.
        user: {
          select: {
            firstName: true,
            lastName: true,
            employeeId: true,
            team: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const duplicatesByReport = computeDuplicates(detectionPool);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          scopedTeamLabel
            ? `${scopedTeamLabel} — Team Reports`
            : isAdmin
            ? "Daily Reports"
            : isPartner
            ? "Team Reports"
            : "Etsy Team Reports"
        }
        description={
          scopedTeamLabel
            ? `Daily reports submitted by ${scopedTeamLabel}`
            : isAdmin
            ? "All daily reports submitted by the team"
            : isPartner
            ? "Daily reports submitted by your team members"
            : "Daily reports submitted by your Etsy team members"
        }
      />
      <DailyReportView
        reports={JSON.parse(JSON.stringify(reports))}
        duplicatesByReport={JSON.parse(JSON.stringify(duplicatesByReport))}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
