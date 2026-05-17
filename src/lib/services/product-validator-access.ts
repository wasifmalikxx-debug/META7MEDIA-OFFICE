import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the Product Validator role gate.
 *
 * Access policy (May 17 2026 — launch):
 *  - CEO / SUPER_ADMIN                     → real tool
 *  - MANAGER (Izaan, EM-4)                 → real tool
 *  - EM employees (EM-* except EM-4 / 4L)  → real tool
 *  - AE employees (AE-*)                   → real tool
 *  - ME employees (ME-*)                   → real tool
 *  - Etsy PARTNERs (Awais, Mubeen)         → real tool
 *  - HR / Facebook / Zain                  → Coming Soon placeholder
 *
 * Rationale: the validator is a $0/check pre-listing safety tool —
 * every Etsy seller should have it before they post a single listing,
 * to stop shop strikes before they happen. No reason to gate it.
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
