import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PriceCalculatorView } from "@/components/price-calculator/price-calculator-view";

export const dynamic = "force-dynamic";

/**
 * Etsy price calculator — pure client-side tool. Strictly Etsy-side of
 * the org; FB-team members never see this page (no link in their sidebar,
 * and direct URL hits redirect them out).
 *
 * Access:
 *  - CEO / HR Admin                 → allowed
 *  - Etsy PARTNERs (Awais, Mubeen)  → allowed
 *  - Non-Etsy PARTNER (Zain / FB)   → BLOCKED (page guard checks team dept)
 *  - MANAGER (Izaan, EM-4)          → allowed
 *  - Etsy-style employees           → allowed (EM- / AE- / ME- prefixes)
 *  - EM-4L (non-Etsy ecom)          → BLOCKED
 *  - SMM-* (Facebook team)          → BLOCKED
 *  - Everyone else                  → BLOCKED
 */
export default async function PriceCalculatorPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;
  const isAdmin = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";
  const isPartner = user.role === "PARTNER";
  const isManager = user.employeeId === "EM-4";
  const empId: string | undefined = user.employeeId;
  const isEtsyEmployee =
    typeof empId === "string" &&
    !isManager &&
    (empId.startsWith("EM") || empId.startsWith("AE") || empId.startsWith("ME"));

  // EM-4L (Abdullah) was hired for non-Etsy ecom work — block.
  if (empId === "EM-4L") {
    redirect("/dashboard");
  }

  // For PARTNER, check the team's department before granting access.
  // Zain leads "Facebook - O2" — he should NOT see this page even though
  // his role is PARTNER. Awais/Mubeen's teams are Etsy departments, they
  // pass.
  let isEtsyPartner = false;
  if (isPartner) {
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

  if (!isAdmin && !isEtsyPartner && !isManager && !isEtsyEmployee) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Etsy Price Calculator"
        description="Convert an Ali Express cost into the recommended Etsy listing price using the team's stepped markup table."
      />
      <PriceCalculatorView />
    </div>
  );
}
