import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SeoAutopilotComingSoon } from "@/components/seo-autopilot/coming-soon-view";
import { SeoAutopilotView } from "@/components/seo-autopilot/autopilot-view";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

export const dynamic = "force-dynamic";

/**
 * SEO Autopilot — AI-powered Etsy listing generator.
 *
 * **Etsy team + Etsy partners (May 15 2026)**: rollout broadened from
 * EM-only to include Etsy partners (Awais, Mubeen). AE / ME employees
 * still see Coming Soon; we'll fold them in once we validate quota +
 * cost holds at this scale.
 *
 * Daily limit: 8 generations per Pakistan calendar day (CEO unlimited).
 * The API route mirrors this check server-side, so even if a non-EM
 * user reaches the real UI (e.g. via a stale page bundle) the backend
 * refuses to generate.
 *
 * Page-level access:
 *  - CEO / SUPER_ADMIN                     → REAL tool · unlimited
 *  - MANAGER (Izaan, EM-4)                 → REAL tool · 8/day
 *  - EM employees (EM-* except EM-4 / 4L)  → REAL tool · 8/day
 *  - Etsy PARTNERs (Awais, Mubeen)         → REAL tool · 8/day  ← NEW
 *  - HR Admin                              → Coming Soon
 *  - AE / ME employees                     → Coming Soon (test phase)
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
    // No PageHeader — the hero banner inside the view already provides
    // the title + tagline. PageHeader was a duplicate.
    // Pass isCeo so the inline history section can hide cost UI from
    // non-CEO users — only Wasif sees what each gen costs.
    return <SeoAutopilotView isCeo={access.isCeo} />;
  }

  // AE / ME employees + HR see Coming Soon until we broaden again.
  return <SeoAutopilotComingSoon />;
}
