import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { EtsyAnalyticsView } from "@/components/analytics/etsy-analytics-view";
import { resolveEtsyScope } from "@/lib/etsy-team-scope";

export const dynamic = "force-dynamic";

export default async function EtsyAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  // Analytics is CEO + PARTNER only. Izaan is a team lead (MANAGER), not a
  // partner — he sees the bonus program for EM but not the analytics tab.
  if (role !== "SUPER_ADMIN" && role !== "PARTNER") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const scope = await resolveEtsyScope(role, session.user.id, params.team);
  if (!scope) redirect("/dashboard");

  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = pkt.getUTCMonth() + 1;
  const year = pkt.getUTCFullYear();

  const pageTitle = `${scope.departmentName} Analytics`;
  const description =
    role === "PARTNER"
      ? `Sales analytics for your team`
      : `Sales analytics for ${scope.departmentName}`;

  return (
    <div className="space-y-6">
      <PageHeader title={pageTitle} description={description} />
      {/* Key on scope so React fully remounts the client view when the CEO
          switches teams (?team=em → ?team=ae). The component stores `data`
          in useState seeded from initial props; without the key, the OLD
          team's analytics stays on screen for the 30–60s it takes the new
          team's sheets to load (or until the user manually refreshes).
          Same fix we applied to /refunds for the same root cause. */}
      <EtsyAnalyticsView
        key={`analytics-${scope.teamKey}`}
        initialMonth={month}
        initialYear={year}
        teamKey={scope.teamKey}
      />
    </div>
  );
}
