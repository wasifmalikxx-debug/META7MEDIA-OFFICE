import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SeoAutopilotComingSoon } from "@/components/seo-autopilot/coming-soon-view";
import { SeoAutopilotView } from "@/components/seo-autopilot/autopilot-view";
import { SeoAutopilotHero } from "@/components/seo-autopilot/seo-autopilot-hero";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

export const dynamic = "force-dynamic";

/**
 * SEO Autopilot — AI-powered Etsy listing generator.
 *
 * Access — **LOCKED TO CEO (Aug 6 2026, CEO directive)**; was a full
 * Etsy team tool (May 18 2026):
 *  - CEO / SUPER_ADMIN → REAL tool · unlimited
 *  - EVERYONE else (managers, EM/AE/ME employees, partners, HR) →
 *    Coming Soon placeholder. The API routes mirror this via
 *    `canUseSeoAutopilot`, so a stale client bundle can't bypass it.
 */
export default async function SeoAutopilotPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const empId: string | undefined = user.employeeId;

  // Shared role gate — single source of truth for SEO Autopilot access.
  const access = await getSeoAutopilotAccess({
    id: user.id,
    role: user.role,
    employeeId: empId ?? null,
  });

  if (access.canUseSeoAutopilot) {
    // Full-bleed hero + constrained content column — same shell as
    // the Price Calculator, Product Hunter, and Product Validator
    // pages. All four Etsy Tools now share the same page-level
    // structure.
    return (
      <div className="relative pb-12">
        <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
          <SeoAutopilotHero />
        </div>
        <SeoAutopilotView isCeo={access.isCeo} />
      </div>
    );
  }

  // Everyone who isn't the CEO sees the Coming Soon placeholder.
  return <SeoAutopilotComingSoon />;
}
