import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the Product Validator role gate.
 *
 * Access policy (May 18 2026 — full Etsy team rollout):
 *  - CEO / SUPER_ADMIN                     → real tool, unlimited
 *  - MANAGER (Izaan, EM-4)                 → real tool, unlimited
 *  - EM employees (EM-* except EM-4L)      → real tool, unlimited
 *  - AE employees (AE-*)                   → real tool, unlimited
 *  - ME employees (ME-*)                   → real tool, unlimited
 *  - Etsy PARTNERs (Awais, Mubeen)         → real tool, unlimited
 *  - HR / Facebook / Zain                  → Coming Soon
 *
 * No daily quota — validation is cheap (~$0.006/check with vision,
 * $0 for hard-block or cleared products) and high-value since it
 * prevents shop strikes. Letting the team validate freely is more
 * important than capping spend.
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
