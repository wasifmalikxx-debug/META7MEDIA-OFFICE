import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { SeoAutopilotComingSoon } from "@/components/seo-autopilot/coming-soon-view";

export const dynamic = "force-dynamic";

/**
 * SEO Autopilot — AI-powered Etsy listing generator.
 *
 * Pre-build placeholder. The sidebar link is visible to every Etsy-side
 * user so they know it's coming, but the page itself currently shows a
 * "Coming Soon" view. Once the tool is functional, the CEO will be the
 * only one with the live UI — others will continue to see Coming Soon
 * until we roll it out more broadly.
 *
 * Access (same as Price Calculator):
 *  - CEO / HR Admin                 → allowed
 *  - Etsy PARTNERs (Awais, Mubeen)  → allowed
 *  - Non-Etsy PARTNER (Zain / FB)   → BLOCKED
 *  - MANAGER (Izaan, EM-4)          → allowed
 *  - Etsy-style employees           → allowed (EM- / AE- / ME- prefixes)
 *  - EM-4L (non-Etsy ecom)          → BLOCKED
 *  - SMM-* (Facebook team)          → BLOCKED
 */
export default async function SeoAutopilotPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;
  const isAdmin = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";
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

  if (!isAdmin && !isEtsyPartner && !isManager && !isEtsyEmployee) {
    redirect("/dashboard");
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
