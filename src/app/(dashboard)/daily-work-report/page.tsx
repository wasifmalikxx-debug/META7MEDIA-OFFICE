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
 *  - SUPER_ADMIN (CEO)     → all reports, both Etsy + FB teams
 *  - Izaan (EM-4 team lead) → Etsy team reports ONLY (scoped at query level)
 *  - Everyone else          → redirected to /dashboard
 *
 * Scoping is enforced on the server query, not just the UI, so Izaan can
 * never see FB team reports even if he crafts a request manually.
 */
export default async function DailyReportPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;
  const role = user.role;
  const isAdmin = role === "SUPER_ADMIN";
  const isEtsyTeamLead = user.employeeId === "EM-4";

  if (!isAdmin && !isEtsyTeamLead) {
    redirect("/dashboard");
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

  // Build the where clause. For Izaan, restrict to Etsy team members only
  // (employeeId starts with "EM"). For CEO, no restriction.
  const baseWhere: any = isEtsyTeamLead && !isAdmin
    ? { user: { employeeId: { startsWith: "EM" } } }
    : {};

  // Fetch the currently-viewed month for display AND the 3-month detection
  // window for duplicate analysis, in parallel. The detection pool is
  // ordered oldest-first so the first occurrence of each listing ID is
  // correctly identified as the canonical origin.
  const [reports, detectionPool] = await Promise.all([
    prisma.dailyReport.findMany({
      where: { ...baseWhere, date: { gte: startOfMonth, lte: endOfMonth } },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.dailyReport.findMany({
      where: { ...baseWhere, date: { gte: detectionStart, lte: endOfMonth } },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const duplicatesByReport = computeDuplicates(detectionPool);

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAdmin ? "Daily Reports" : "Etsy Team Reports"}
        description={
          isAdmin
            ? "All daily reports submitted by the team"
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
