import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { EtsyAnalyticsView } from "@/components/analytics/etsy-analytics-view";

export const dynamic = "force-dynamic";

export default async function EtsyAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") {
    redirect("/dashboard");
  }

  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = pkt.getUTCMonth() + 1;
  const year = pkt.getUTCFullYear();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Etsy Analytics"
        description="Comprehensive sales analytics across all Etsy employees and shops"
      />
      <EtsyAnalyticsView initialMonth={month} initialYear={year} />
    </div>
  );
}
