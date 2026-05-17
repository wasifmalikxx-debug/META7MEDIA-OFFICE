import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for the Product Validator role gate.
 *
 * Access policy (May 18 2026 — tightened to CEO-only while we tune):
 *  - CEO / SUPER_ADMIN                     → real tool
 *  - Everyone else                         → Coming Soon placeholder
 *
 * The Etsy team rollout is paused while the tool's rule set is being
 * tuned. Reopen access by adding back the role/employee checks below.
 *
 * Earlier policy kept here as a comment for fast revert:
 *   isManager        empId === "EM-4"
 *   isEmEmployee     empId startsWith "EM" and !== "EM-4" / "EM-4L"
 *   isAeEmployee     empId startsWith "AE"
 *   isMeEmployee     empId startsWith "ME"
 *   isEtsyPartner    PARTNER role on an EM/AE/ME team
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
