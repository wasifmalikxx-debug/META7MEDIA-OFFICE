import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the Daily Trending role gate.
 *
 * Mirrors `getSeoAutopilotAccess` shape so adding a new role is a
 * one-line change instead of a 4-file edit (page + 2 API routes +
 * sidebar). Keep this in sync with the sidebar block below.
 *
 * Access policy (May 16 2026 — initial rollout):
 *  - CEO / SUPER_ADMIN                     → unlimited + admin view
 *  - MANAGER (Izaan, EM-4)                 → real tool (own + team niches)
 *  - EM employees (EM-* except EM-4 / 4L)  → real tool, own niches
 *  - AE employees (AE-*)                   → real tool, own niches
 *  - ME employees (ME-*)                   → real tool, own niches
 *  - Etsy PARTNERs (Awais, Mubeen)         → real tool, own niches
 *  - Everyone else (HR / Facebook / Zain)  → Coming Soon placeholder
 *
 * Why broader than SEO Autopilot? Daily Trending is read-only AE
 * data (no expensive Claude calls), so we can give every Etsy
 * seller access without worrying about per-user quota costs.
 */

export interface DailyTrendingAccess {
  isCeo: boolean;
  isManager: boolean;
  isEmEmployee: boolean;
  isAeEmployee: boolean;
  isMeEmployee: boolean;
  isEtsyPartner: boolean;
  /** True if the user can manage niches + see the tool. */
  canUseRealTool: boolean;
}

export async function getDailyTrendingAccess(user: {
  id: string;
  role: string;
  employeeId?: string | null;
}): Promise<DailyTrendingAccess> {
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
  };
}
