import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProductHunterView } from "@/components/seo-autopilot/product-hunter-view";
import { ProductHunterHero } from "@/components/seo-autopilot/product-hunter-hero";
import { ProductHunterComingSoon } from "@/components/seo-autopilot/product-hunter-coming-soon";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

export const dynamic = "force-dynamic";

/**
 * /seo-autopilot/product-hunter — Etsy niche scanner.
 *
 * Seller enters a seed product type or niche. Product Hunter asks Claude
 * to brainstorm 25 long-tail variants, then hits Etsy live for each
 * one to gather demand + engagement + shop diversity stats. The
 * highest-scoring "underserved" keywords surface at the top — those
 * are the niches employees should hunt on AliExpress next.
 *
 * Access policy (May 16 2026 — EM-team rollout):
 *  - SUPER_ADMIN (Wasif)                   → real tool, full AE controls
 *  - Etsy Partners (Awais, Mubeen)         → real tool, AE status-only
 *  - MANAGER (Izaan, EM-4)                 → real tool, AE hidden
 *  - EM employees (EM-* except 4 / 4L)     → real tool, AE hidden  ← NEW
 *  - Everyone else with SEO Autopilot      → Coming Soon placeholder
 *  - Everyone else                         → redirect to /dashboard
 *
 * All non-CEO users borrow the CEO's stored AE access token for the
 * preview step (the AE OAuth is CEO-only). See AliExpressHeaderPill
 * for the role-aware UI that hides AE controls from non-CEO users.
 *
 * Renamed from Opportunity Scanner on May 15 2026.
 */
export default async function ProductHunterPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;

  // Compute access via the shared predicate (single source of truth
  // shared with /api/seo-autopilot/hunt-by-niche + swap-tag).
  const access = await getSeoAutopilotAccess({
    id: user.id,
    role: user.role,
    employeeId: user.employeeId ?? null,
  });

  if (access.canUseProductHunter) {
    // Full-bleed hero + constrained content column — same layout as
    // the Price Calculator and Product Validator pages so the four
    // Etsy Tools all read as one consistent product family.
    return (
      <div className="relative pb-12">
        <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
          <ProductHunterHero userRole={user.role} />
        </div>
        <div className="max-w-5xl mx-auto">
          <ProductHunterView userRole={user.role} />
        </div>
      </div>
    );
  }

  // Everyone else (HR Admin, AE/ME employees, EM-4L, Facebook team,
  // anyone direct-navigating without access) sees the Coming Soon
  // placeholder rather than a hard redirect — informative + friendly.
  // No sidebar link is rendered for these users, so they only land
  // here intentionally (e.g. via a shared URL).
  return <ProductHunterComingSoon />;
}
