import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the Product Validator role gate.
 *
 * Access policy (May 18 2026 — BETA launch to the EM team):
 *  - CEO / SUPER_ADMIN                     → real tool
 *  - MANAGER (Izaan, EM-4)                 → real tool
 *  - EM employees (EM-* except EM-4L)      → real tool
 *  - AE / ME employees                     → Coming Soon (next wave)
 *  - Etsy PARTNERs                         → Coming Soon (next wave)
 *  - HR / Facebook / Zain                  → Coming Soon
 *
 * Rationale: the rule set + AI reframe pipeline are fresh — the EM
 * team validates the tool first against their actual sourcing
 * workflow. Once their feedback is clean, add AE / ME / Partners
 * back to the canUseRealTool union below.
 */

export interface ProductValidatorAccess {
  isCeo: boolean;
  isManager: boolean;
  isEmEmployee: boolean;
  isAeEmployee: boolean;
  isMeEmployee: boolean;
  isEtsyPartner: boolean;
  /** True when the caller can use the validator. */
  canUseRealTool: boolean;
}

export async function getProductValidatorAccess(user: {
  id: string;
  role: string;
  employeeId?: string | null;
}): Promise<ProductValidatorAccess> {
  const isCeo = user.role === "SUPER_ADMIN";
  const empId = user.employeeId;

  // Role/team flags are still computed so the rest of the app (sidebar
  // pill copy, dashboards) keeps reading them, but they no longer
  // affect access. canUseRealTool gates only on isCeo for now.
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

  const canUseRealTool = isCeo || isManager || isEmEmployee;

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
