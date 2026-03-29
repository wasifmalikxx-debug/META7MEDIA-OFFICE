import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { DailyReportView } from "@/components/daily-report/daily-report-view";

export const dynamic = "force-dynamic";

export default async function DailyReportPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") redirect("/dashboard");

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  const reports = await prisma.dailyReport.findMany({
    where: { date: { gte: startOfMonth, lte: endOfMonth } },
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
    },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Daily Reports" />
      <DailyReportView
        reports={JSON.parse(JSON.stringify(reports))}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
