import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { SeoAutopilotComingSoon } from "@/components/seo-autopilot/coming-soon-view";
import { SeoAutopilotView } from "@/components/seo-autopilot/autopilot-view";

export const dynamic = "force-dynamic";

/**
 * SEO Autopilot — AI-powered Etsy listing generator.
 *
 * Two-tier visibility (deliberate — Wasif wants this in private beta):
 *
 *   CEO (SUPER_ADMIN, Wasif) → the FULL SaaS tool. Live Etsy API +
 *                              Claude Sonnet/Haiku generation.
 *
 *   Everyone else on the   → "Coming Soon" placeholder. They still see the
 *   Etsy team               sidebar entry (with a SOON pill) so they know
 *                            it's being built, but they don't get access
 *                            until Wasif rolls it out more broadly.
 *
 * The API route (`/api/seo-autopilot/generate`) enforces the same
 * SUPER_ADMIN-only check server-side, so even if a non-CEO somehow
 * reaches the real UI (e.g. via a stale page bundle) the backend won't
 * generate anything for them.
 *
 * Page-level access (who reaches this route at all — keeps the FB team
 * and EM-4L out entirely):
 *  - CEO / HR Admin                 → allowed (CEO sees real tool, HR sees Coming Soon)
 *  - Etsy PARTNERs (Awais, Mubeen)  → allowed → Coming Soon
 *  - Non-Etsy PARTNER (Zain / FB)   → BLOCKED
 *  - MANAGER (Izaan, EM-4)          → allowed → Coming Soon
 *  - Etsy-style employees           → allowed → Coming Soon
 *  - EM-4L (non-Etsy ecom)          → BLOCKED
 *  - SMM-* (Facebook team)          → BLOCKED
 */
export default async function SeoAutopilotPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const isCeo = user.role === "SUPER_ADMIN";
  const isHrAdmin = user.role === "HR_ADMIN";
  const isPartner = user.role === "PARTNER";
  const isManager = user.employeeId === "EM-4";
  const empId: string | undefined = user.employeeId;
  const isEtsyEmployee =
    typeof empId === "string" &&
    !isManager &&
    (empId.startsWith("EM") || empId.startsWith("AE") || empId.startsWith("ME"));

  if (empId === "EM-4L") {
    redirect("/dashboard");
  }

  // Partner check — only Etsy-team partners. Same logic the sidebar uses
  // so view/UI stay in lockstep.
  let isEtsyPartner = false;
  if (isPartner) {
    const partnerTeams = await prisma.team.findMany({
      where: { partnerId: user.id },
      select: { department: { select: { name: true } } },
    });
    isEtsyPartner = partnerTeams.some(
      (t) =>
        t.department?.name.includes(" - EM") ||
        t.department?.name.includes(" - AE") ||
        t.department?.name.includes(" - ME"),
    );
  }

  if (!isCeo && !isHrAdmin && !isEtsyPartner && !isManager && !isEtsyEmployee) {
    redirect("/dashboard");
  }

  // ─── Split here ─────────────────────────────────────────────────────
  // CEO gets the real tool. Everyone else (HR, partners, manager, Etsy
  // employees) gets the same Coming Soon placeholder they've been seeing.

  if (isCeo) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="SEO Autopilot"
          description="AI-powered Etsy listing generator — title, tags, description, and attributes from a single product brief."
        />
        <SeoAutopilotView />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="SEO Autopilot"
        description="AI-powered Etsy listing generator — title, tags, description, and attributes from a single product brief."
      />
      <SeoAutopilotComingSoon />
    </div>
  );
}
