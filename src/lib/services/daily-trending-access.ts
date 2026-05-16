import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the Daily Trending role gate.
 *
 * Mirrors `getSeoAutopilotAccess` shape so adding a new role is a
 * one-line change instead of a 4-file edit (page + 2 API routes +
 * sidebar). The role flags below are kept populated for future
 * expansion — flipping the team back on is a one-line change to
 * `canUseRealTool` (just OR the desired roles back in).
 *
 * Access policy (May 16 2026 — CEO solo validation phase):
 *  - CEO / SUPER_ADMIN                     → real tool, CEO niche book
 *  - Everyone else (incl. EM team)         → Coming Soon placeholder
 *
 * Why CEO-only initially? Wasif wants to validate the daily picks
 * himself before turning the team loose on AE links pulled from a
 * fully-automated feed. Same rollout pattern Product Hunter
 * followed: CEO solo → EM team → full team.
 *
 * Mounted as a tab inside the Product Hunter hub (May 16 2026 v3) —
 * the standalone /daily-trending URL redirects to the tab.
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

  // CEO-only during the validation phase. To expand later, just OR
  // in the role flags below (isManager || isEmEmployee || ...) — the
  // rest of the stack (APIs, page, tab UI) needs no changes.
  const canUseRealTool = isCeo;

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
