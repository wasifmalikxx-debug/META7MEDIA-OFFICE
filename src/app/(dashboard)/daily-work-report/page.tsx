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

  // Display + detection window — both 3 months ending today (PKT). The page
  // used to show only the current month, but the duplicate-detection logic
  // already scanned 3 months on the server side; the side effect was that
  // duplicates flagged on screen referenced reports the CEO couldn't see
  // until they navigated back. Showing the full 3-month window puts the
  // original AND the duplicate in the same scroll, no navigation needed.
  // 3 months also matches the cleanup cron's retention — anything older is
  // already pruned, so a longer window would return nothing.
  const windowEnd = _pkt;
  const windowStart = new Date(Date.UTC(_pkt.getUTCFullYear(), _pkt.getUTCMonth() - 2, 1));

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

  // Single 3-month query — covers both display + duplicate detection now
  // that they share the same window. computeDuplicates() needs ASC order
  // (oldest first) to identify the canonical first occurrence; the view
  // re-sorts to date-desc for rendering.
  const detectionPool = await prisma.dailyReport.findMany({
    where: { ...baseWhere, date: { gte: windowStart, lte: windowEnd } },
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
  });
  const duplicatesByReport = computeDuplicates(detectionPool);

  // Display order — newest date first, newest report within a date first.
  const reports = [...detectionPool].sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    if (db !== da) return db - da;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

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
            ? `Past 3 months of reports from ${scopedTeamLabel} — duplicates flagged across the entire window`
            : isAdmin
            ? "Past 3 months of reports across the team — duplicates flagged across the entire window"
            : isPartner
            ? "Past 3 months of reports from your team — duplicates flagged across the entire window"
            : "Past 3 months of reports from your Etsy team — duplicates flagged across the entire window"
        }
      />
      <DailyReportView
        reports={JSON.parse(JSON.stringify(reports))}
        duplicatesByReport={JSON.parse(JSON.stringify(duplicatesByReport))}
        windowStart={windowStart.toISOString()}
        windowEnd={windowEnd.toISOString()}
      />
    </div>
  );
}
