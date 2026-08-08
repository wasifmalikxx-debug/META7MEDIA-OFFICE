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
  searchParams: Promise<{ month?: string; year?: string; team?: string; range?: string }>;
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

  // ─── Detection pool vs display window ────────────────────────────────
  //
  // We deliberately split these so an employee resubmitting their own old
  // listing (or someone else's old listing) still trips the duplicate flag
  // even when the CEO has the "This Month" filter active:
  //
  //   • detectionPool — ALWAYS rolling 3 months. computeDuplicates walks
  //     this to identify the canonical first occurrence of each Etsy
  //     listing ID. Anything older was already pruned by the cleanup cron.
  //
  //   • display window — bounded by ?range=month|3m. Reports outside this
  //     window aren't shown, but their listing IDs are still tracked in
  //     detectionPool so a current-month resubmission of a 2-month-old
  //     link gets flagged red on screen.
  const rangeKey: "month" | "3m" = params.range === "month" ? "month" : "3m";
  const detectionStart = new Date(Date.UTC(_pkt.getUTCFullYear(), _pkt.getUTCMonth() - 2, 1));
  const detectionEnd = _pkt;
  const windowEnd = _pkt;
  const windowStart =
    rangeKey === "month"
      ? new Date(Date.UTC(_pkt.getUTCFullYear(), _pkt.getUTCMonth(), 1))
      : detectionStart;

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
    // Scope Izaan to his OWN DEPARTMENT (Etsy - EM, OFFICE 1) — never by an
    // employee-ID prefix. The old `employeeId startsWith "EM"` matched ANY id
    // beginning with those two letters, so a malformed OFFICE 2 id (e.g.
    // "EM5", created on Mubeen's Etsy - ME team on 2026-08-04) leaked that
    // employee's reports into Izaan's inbox. Izaan has no involvement with
    // OFFICE 2, and department scoping is what every other Izaan surface
    // already uses (refunds, review-bonus, bonus-eligibility). Fails CLOSED
    // if he somehow has no department, rather than showing everything.
    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { departmentId: true },
    });
    baseWhere = me?.departmentId
      ? { user: { departmentId: me.departmentId } }
      : { userId: { in: ["__none__"] } };
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

  // Always pull the full 3-month detection pool, regardless of the active
  // display range. computeDuplicates() needs ASC order (oldest first) to
  // identify the canonical first occurrence of each Etsy listing ID across
  // every report — including the employee's OWN earlier reports — so a
  // resubmission of a previously-logged listing trips the flag whether
  // it came from the same person or a teammate.
  const detectionPool = await prisma.dailyReport.findMany({
    where: { ...baseWhere, date: { gte: detectionStart, lte: detectionEnd } },
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

  // Display = filter the detection pool down to the active window, then
  // sort newest-first. Reports outside the window are still in
  // duplicatesByReport (so their listing IDs were considered for
  // first-occurrence resolution), they just aren't rendered.
  const winStartTime = windowStart.getTime();
  const winEndTime = windowEnd.getTime();
  const reports = detectionPool
    .filter((r) => {
      const t = new Date(r.date).getTime();
      return t >= winStartTime && t <= winEndTime;
    })
    .sort((a, b) => {
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
          rangeKey === "month"
            ? "Current month — duplicates still flagged against the past 3 months of submissions"
            : "Past 3 months — duplicates flagged across the entire window"
        }
      />
      <DailyReportView
        reports={JSON.parse(JSON.stringify(reports))}
        duplicatesByReport={JSON.parse(JSON.stringify(duplicatesByReport))}
        windowStart={windowStart.toISOString()}
        windowEnd={windowEnd.toISOString()}
        range={rangeKey}
      />
    </div>
  );
}
