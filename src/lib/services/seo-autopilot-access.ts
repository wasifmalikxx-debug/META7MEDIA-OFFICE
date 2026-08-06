import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the SEO Autopilot + Product Hunter role gate.
 *
 * Replicated previously in three places (page.tsx, generate/route.ts,
 * swap-tag/route.ts) which drifted when access policy changed. This
 * helper consolidates the predicate so adding a new role is a one-line
 * change instead of a 3-file edit.
 *
 * Access policy — TWO separate predicates since Aug 6 2026:
 *  - `canUseSeoAutopilot` → **CEO / SUPER_ADMIN ONLY** (CEO directive;
 *    the generator was the full Etsy team until the lock).
 *  - `canUseProductHunter` → still the full Etsy team: CEO, MANAGER
 *    (Izaan EM-4), EM/AE/ME employees, Etsy PARTNERs (Awais, Mubeen).
 *    Product Hunter was NOT part of the lock — keep these apart so
 *    locking one tool never silently locks the other.
 *
 * Zain (Facebook-only partner) is excluded — he has no EM/AE/ME teams
 * so `isEtsyPartner` resolves false for him.
 *
 * Note: the generator's 8/day quota is now moot (CEO is unlimited) but
 * kept in place so lifting the lock restores it; Product Hunter has a
 * separate quota (5/day) tracked in `ProductHunterUsage`.
 */

export interface SeoAutopilotAccess {
  isCeo: boolean;
  isManager: boolean;
  isEmEmployee: boolean;
  isAeEmployee: boolean;
  isMeEmployee: boolean;
  isEtsyPartner: boolean;
  /** SEO Autopilot generator — CEO-ONLY since Aug 6 2026 (CEO directive). */
  canUseSeoAutopilot: boolean;
  /** Product Hunter — still the full Etsy team (NOT part of the Aug 2026 lock). */
  canUseProductHunter: boolean;
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

  // The Etsy-team predicate. Product Hunter still uses this — it was NOT
  // part of the Aug 6 2026 lock.
  const isEtsyTeam =
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
    // LOCKED TO CEO (Aug 6 2026, CEO directive): the SEO Autopilot
    // GENERATOR (page + /api/seo-autopilot/generate + swap-tag) is
    // CEO-only. Kept as its own predicate — deliberately separate from
    // Product Hunter below, so locking one can never silently lock the
    // other (they share this service).
    canUseSeoAutopilot: isCeo,
    // Product Hunter keeps the full Etsy-team access it had.
    canUseProductHunter: isEtsyTeam,
    isUnlimited: isCeo,
    productHunterUnlimited: isCeo || isManager,
  };
}
