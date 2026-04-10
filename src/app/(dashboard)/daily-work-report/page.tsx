import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { DailyReportView } from "@/components/daily-report/daily-report-view";

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

  // Build the where clause. For Izaan, restrict to Etsy team members only
  // (employeeId starts with "EM"). For CEO, no restriction.
  const where: any = { date: { gte: startOfMonth, lte: endOfMonth } };
  if (isEtsyTeamLead && !isAdmin) {
    where.user = { employeeId: { startsWith: "EM" } };
  }

  const reports = await prisma.dailyReport.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
    },
    orderBy: { date: "desc" },
  });

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
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
