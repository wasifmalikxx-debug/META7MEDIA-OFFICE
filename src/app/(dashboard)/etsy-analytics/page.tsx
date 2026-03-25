import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { EtsyAnalyticsView } from "@/components/analytics/etsy-analytics-view";

export default async function EtsyAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") {
    redirect("/dashboard");
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

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
