/**
 * Single source of truth for the Product Validator role gate.
 *
 * Access policy — **LOCKED TO CEO (Aug 6 2026, CEO directive)**:
 *  - CEO / SUPER_ADMIN → real tool, unlimited
 *  - EVERYONE else (managers incl. Izaan, EM/AE/ME employees, partners,
 *    HR, Facebook team) → Coming Soon placeholder
 * (Was the full Etsy team from May 18 2026 until the lock.)
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

  // Etsy-partner lookup is skipped entirely under the CEO lock below: it
  // fed only `canUseRealTool`, so running it would be a pointless DB
  // round-trip on every partner page load / API call. If the lock is ever
  // lifted, restore the prisma.team.findMany query here (see
  // seo-autopilot-access.ts, which still needs it for Product Hunter).
  const isEtsyPartner = false;

  // LOCKED TO CEO (Aug 6 2026, CEO directive): Product Validator is no
  // longer available to employees, managers, or partners. Only SUPER_ADMIN
  // can use the tool. Every surface — the page and /api/product-validator —
  // reads this one predicate, so this is the single place the lock lives.
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
