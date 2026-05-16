import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProductHunterView } from "@/components/seo-autopilot/product-hunter-view";
import { ProductHunterComingSoon } from "@/components/seo-autopilot/product-hunter-coming-soon";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

export const dynamic = "force-dynamic";

/**
 * /seo-autopilot/product-hunter — CEO-only Etsy niche scanner.
 *
 * Wasif enters a seed product type or keyword. Product Hunter asks Haiku
 * to brainstorm 25 long-tail variants, then hits Etsy live for each
 * one to gather demand + engagement + shop diversity stats. The
 * highest-scoring "underserved" keywords surface at the top — those
 * are the niches employees should hunt on AliExpress next.
 *
 * Access policy (May 15 2026):
 *  - SUPER_ADMIN (Wasif)               → real Product Hunter tool
 *  - SEO Autopilot users               → "Coming soon" placeholder
 *    (Izaan, EM team, Etsy partners)     so the team knows it's coming
 *  - Everyone else                     → redirect to /dashboard
 *
 * Renamed from Opportunity Scanner on May 15 2026.
 */
export default async function ProductHunterPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  if (user.role === "SUPER_ADMIN") {
    return <ProductHunterView userRole="SUPER_ADMIN" />;
  }

  // Anyone with SEO Autopilot access (Izaan, EM employees, Etsy partners)
  // sees a tailored Coming Soon. Everyone else gets bounced.
  const access = await getSeoAutopilotAccess({
    id: user.id,
    role: user.role,
    employeeId: user.employeeId ?? null,
  });

  if (!access.canUseRealTool) {
    redirect("/dashboard");
  }

  return <ProductHunterComingSoon />;
}
