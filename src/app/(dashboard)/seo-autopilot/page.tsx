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
 * **Full Etsy team rollout (May 18 2026)** — opened to AE + ME
 * employees alongside CEO, Izaan, EM, and Etsy partners. No more Beta
 * framing.
 *
 * Daily limit: 10 generations per Pakistan calendar day (CEO unlimited).
 * The API route mirrors this check server-side, so even a stale
 * client bundle can't bypass the gate.
 *
 * Page-level access:
 *  - CEO / SUPER_ADMIN                     → REAL tool · unlimited
 *  - MANAGER (Izaan, EM-4)                 → REAL tool · 10/day
 *  - EM employees (EM-* except EM-4 / 4L)  → REAL tool · 10/day
 *  - AE employees (AE-*)                   → REAL tool · 10/day
 *  - ME employees (ME-*)                   → REAL tool · 10/day
 *  - Etsy PARTNERs (Awais, Mubeen)         → REAL tool · 10/day
 *  - HR Admin                              → Coming Soon
 *  - Non-Etsy PARTNER (Zain / FB)          → BLOCKED
 *  - EM-4L (non-Etsy ecom)                 → BLOCKED
 *  - SMM-* (Facebook team)                 → BLOCKED
 */
export default async function SeoAutopilotPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const empId: string | undefined = user.employeeId;
  const isHrAdmin = user.role === "HR_ADMIN";
  const isEtsyEmployee =
    typeof empId === "string" &&
    empId !== "EM-4" &&
    (empId.startsWith("EM") || empId.startsWith("AE") || empId.startsWith("ME"));

  if (empId === "EM-4L") {
    redirect("/dashboard");
  }

  // Shared role gate — single source of truth for SEO Autopilot access.
  // Adds Etsy partners (Awais, Mubeen) to the canUseRealTool predicate.
  const access = await getSeoAutopilotAccess({
    id: user.id,
    role: user.role,
    employeeId: empId ?? null,
  });

  // Wider page-level gate — controls who can even land on this URL
  // (real tool OR Coming Soon). HR + AE/ME employees can land but
  // see Coming Soon below.
  const canLand =
    access.isCeo ||
    isHrAdmin ||
    access.isEtsyPartner ||
    access.isManager ||
    isEtsyEmployee;

  if (!canLand) {
    redirect("/dashboard");
  }

  if (access.canUseRealTool) {
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

  // HR Admin sees Coming Soon. AE/ME employees now have full access
  // (May 18 2026 expansion) — they no longer land here.
  return <SeoAutopilotComingSoon />;
}
