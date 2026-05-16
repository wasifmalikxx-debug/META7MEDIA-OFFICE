import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DailyTrendingView } from "@/components/daily-trending/daily-trending-view";
import { DailyTrendingComingSoon } from "@/components/daily-trending/daily-trending-coming-soon";
import { getDailyTrendingAccess } from "@/lib/services/daily-trending-access";

export const dynamic = "force-dynamic";

/**
 * /daily-trending — Fresh AliExpress winners for the seller's niches.
 *
 * Each Etsy employee picks up to 5 niches. A 5 AM PKT cron pulls the
 * top-volume AE products per niche and stores them. The page reads
 * from the DB (no live AE call per visit), shows today's batch grouped
 * by niche, with one-click links to AE / Calculator / Product Hunter
 * + a Claim button to prevent intra-team racing.
 *
 * Access policy (May 16 2026 — initial rollout):
 *  - SUPER_ADMIN (Wasif)        → tool + admin view (sees all niches)
 *  - MANAGER (Izaan, EM-4)      → tool, own niches
 *  - EM/AE/ME employees         → tool, own niches
 *  - Etsy Partners              → tool, own niches
 *  - HR / Facebook / Zain       → Coming Soon placeholder
 */
export default async function DailyTrendingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;

  const access = await getDailyTrendingAccess({
    id: user.id,
    role: user.role,
    employeeId: user.employeeId ?? null,
  });

  if (access.canUseRealTool) {
    return (
      <DailyTrendingView
        currentUserId={user.id}
        isCeo={access.isCeo}
      />
    );
  }

  return <DailyTrendingComingSoon />;
}
