import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SeoAutopilotComingSoon } from "@/components/seo-autopilot/coming-soon-view";
import { SeoAutopilotView } from "@/components/seo-autopilot/autopilot-view";

export const dynamic = "force-dynamic";

/**
 * SEO Autopilot — AI-powered Etsy listing generator.
 *
 * **EM-team-only test rollout (May 14 2026)**: scoped DOWN from the
 * full-Etsy-team rollout so just Izaan + the EM team get the real tool.
 * AE / ME / partners continue to see Coming Soon while we validate
 * cost + Etsy quota + UX with one team first.
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
 *  - HR Admin                              → Coming Soon
 *  - AE / ME employees                     → Coming Soon (test phase)
 *  - Etsy PARTNERs (Awais, Mubeen)         → Coming Soon (test phase)
 *  - Non-Etsy PARTNER (Zain / FB)          → BLOCKED
 *  - EM-4L (non-Etsy ecom)                 → BLOCKED
 *  - SMM-* (Facebook team)                 → BLOCKED
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
  // EM-team-only test phase: only CEO + Izaan (EM-4) + EM employees see
  // the real tool. Partners, AE/ME teams, HR all see Coming Soon. Once
  // we've validated everything with the EM team, broaden by adding the
  // other predicates back to `canUseRealTool` below.

  const isEmEmployee =
    typeof empId === "string" &&
    empId.startsWith("EM") &&
    empId !== "EM-4" &&
    empId !== "EM-4L";
  const isEmTeam = isManager || isEmEmployee; // Izaan + EM employees

  const canUseRealTool = isCeo || isEmTeam;

  if (canUseRealTool) {
    // No PageHeader — the hero banner inside the view already provides
    // the title + tagline. PageHeader was a duplicate.
    return <SeoAutopilotView />;
  }

  // AE / ME employees, Awais, Mubeen, HR all land here during the test
  // phase. They see Coming Soon until we broaden access.
  return <SeoAutopilotComingSoon />;
}
