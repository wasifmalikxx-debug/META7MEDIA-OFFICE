import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the SEO Autopilot role gate.
 *
 * Replicated previously in three places (page.tsx, generate/route.ts,
 * swap-tag/route.ts) which drifted when access policy changed. This
 * helper consolidates the predicate so adding a new role (e.g. partners
 * on May 15 2026) is a one-line change instead of a 3-file edit.
 *
 * Access policy (May 15 2026 — partners granted access):
 *  - CEO / SUPER_ADMIN                     → unlimited
 *  - MANAGER (Izaan, EM-4)                 → 8/day
 *  - EM employees (EM-* except EM-4 / 4L)  → 8/day
 *  - Etsy PARTNERs (Awais, Mubeen)         → 8/day  (NEW)
 *  - Everyone else                         → blocked
 *
 * Zain (Facebook-only partner) is excluded — he has no EM/AE/ME teams
 * so `isEtsyPartner` resolves false for him.
 */

export interface SeoAutopilotAccess {
  isCeo: boolean;
  isManager: boolean;
  isEmEmployee: boolean;
  isEtsyPartner: boolean;
  canUseRealTool: boolean;
  /** True when the user's daily limit doesn't apply (CEO only). */
  isUnlimited: boolean;
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
    isCeo || isManager || isEmEmployee || isEtsyPartner;

  return {
    isCeo,
    isManager,
    isEmEmployee,
    isEtsyPartner,
    canUseRealTool,
    isUnlimited: isCeo,
  };
}
