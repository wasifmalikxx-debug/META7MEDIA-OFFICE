import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { MyReportsView } from "@/components/daily-report/my-reports-view";

export const dynamic = "force-dynamic";

/**
 * Employee-only view of their own daily reports.
 * - Read-only (no edits, no deletes)
 * - Organized by date (most recent first)
 * - Scoped strictly to the current user
 * - Filters by month (defaults to current PKT month)
 * - Cleanup cron wipes reports older than 3 months, so the page naturally
 *   refreshes / empties each month without any extra work here
 */
export default async function MyReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Admins don't need this page — send them to the CEO daily reports view
  const role = (session.user as any).role;
  if (role === "SUPER_ADMIN" || role === "HR_ADMIN") {
    redirect("/daily-work-report");
  }

  const userId = session.user.id;
  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const reports = await prisma.dailyReport.findMany({
    where: {
      userId, // strict scoping — employee only sees their own
      date: { gte: startOfMonth, lte: endOfMonth },
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      listingsCount: true,
      storeName: true,
      listingLinks: true,
      postsCount: true,
      pageNames: true,
      notes: true,
      createdAt: true,
    },
  });

  const employeeId = (session.user as any).employeeId as string | undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Reports"
        description="Your personal daily reports archive — view only, refreshes monthly"
      />
      <MyReportsView
        reports={JSON.parse(JSON.stringify(reports))}
        currentMonth={month}
        currentYear={year}
        employeeId={employeeId || ""}
      />
    </div>
  );
}
