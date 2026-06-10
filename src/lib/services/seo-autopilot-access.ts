import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the SEO Autopilot + Product Hunter role gate.
 *
 * Replicated previously in three places (page.tsx, generate/route.ts,
 * swap-tag/route.ts) which drifted when access policy changed. This
 * helper consolidates the predicate so adding a new role is a one-line
 * change instead of a 3-file edit.
 *
 * Access policy (May 18 2026 — full Etsy team rollout):
 *  - CEO / SUPER_ADMIN                     → unlimited
 *  - MANAGER (Izaan, EM-4)                 → 8/day
 *  - EM employees (EM-* except EM-4 / 4L)  → 8/day
 *  - AE employees (AE-*)                   → 8/day  (NEW)
 *  - ME employees (ME-*)                   → 8/day  (NEW)
 *  - Etsy PARTNERs (Awais, Mubeen)         → 8/day
 *  - Everyone else                         → blocked
 *
 * Zain (Facebook-only partner) is excluded — he has no EM/AE/ME teams
 * so `isEtsyPartner` resolves false for him.
 *
 * Note: SEO Autopilot generator quota stays 8/day; Product Hunter has
 * a separate quota (5/day) tracked in `ProductHunterUsage`.
 */

export interface SeoAutopilotAccess {
  isCeo: boolean;
  isManager: boolean;
  isEmEmployee: boolean;
  isAeEmployee: boolean;
  isMeEmployee: boolean;
  isEtsyPartner: boolean;
  canUseRealTool: boolean;
  /** True when the SEO Autopilot GENERATOR daily limit doesn't apply (CEO only). */
  isUnlimited: boolean;
  /**
   * True when the PRODUCT HUNTER daily limit doesn't apply.
   * CEO + Izaan (EM-4, team leader). CEO directive 2026-06-09: Izaan
   * gets unlimited Product Hunter scans to research freely for the EM
   * team. Kept SEPARATE from `isUnlimited` so his SEO Autopilot
   * generator quota (8/day) stays capped — only Product Hunter is
   * uncapped for him.
   */
  productHunterUnlimited: boolean;
}

export async function getSeoAutopilotAccess(user: {
  id: string;
  role: string;
  employeeId?: string | null;
}): Promise<SeoAutopilotAccess> {
  const isCeo = user.role === "SUPER_ADMIN";
  const empId = user.employeeId;
  const isManager = empId === "EM-4"; // Izaan
  const isEmEmployee =
    typeof empId === "string" &&
    empId.startsWith("EM") &&
    empId !== "EM-4" &&
    empId !== "EM-4L";
  const isAeEmployee = typeof empId === "string" && empId.startsWith("AE");
  const isMeEmployee = typeof empId === "string" && empId.startsWith("ME");

  // Etsy partner check — only PARTNERs whose teams sit in an Etsy
  // department (EM / AE / ME). Cheap query: partnerId is indexed and
  // each partner has 1-2 teams.
  let isEtsyPartner = false;
  if (user.role === "PARTNER") {
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

  const canUseRealTool =
    isCeo ||
    isManager ||
    isEmEmployee ||
    isAeEmployee ||
    isMeEmployee ||
    isEtsyPartner;

  return {
    isCeo,
    isManager,
    isEmEmployee,
    isAeEmployee,
    isMeEmployee,
    isEtsyPartner,
    canUseRealTool,
    isUnlimited: isCeo,
    productHunterUnlimited: isCeo || isManager,
  };
}
