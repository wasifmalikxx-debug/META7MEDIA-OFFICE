import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { SeoAutopilotDashboardView } from "@/components/seo-autopilot/dashboard-view";

export const dynamic = "force-dynamic";

/**
 * SEO Autopilot — full-page admin dashboard.
 *
 * SUPER_ADMIN only. Anyone else gets redirected back to /seo-autopilot
 * (the tool page) where they see the regular usage chip but not the
 * cross-team analytics.
 *
 * This page is the "admin view" — every employee across every
 * department, full cost breakdown, daily trend chart, per-department
 * aggregation, and the full event audit log. Pairs with the tool at
 * /seo-autopilot which is now just the generator UI.
 */
export default async function SeoAutopilotDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") {
    redirect("/seo-autopilot");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="SEO Autopilot · Dashboard"
        description="Cross-team usage and spend analytics — every employee, every department, every event."
      />
      <SeoAutopilotDashboardView />
    </div>
  );
}
