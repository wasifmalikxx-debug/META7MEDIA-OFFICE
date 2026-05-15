import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReverseHuntView } from "@/components/reverse-hunt/reverse-hunt-view";
import { ReverseHuntComingSoon } from "@/components/reverse-hunt/reverse-hunt-coming-soon";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

export const dynamic = "force-dynamic";

/**
 * /reverse-hunt — Play 2.
 *
 * Paste an AliExpress URL → get an Etsy demand verdict + projected margin.
 *
 * Access policy (May 15 2026):
 *  - SUPER_ADMIN (Wasif)                  → real Reverse Hunt tool
 *  - SEO Autopilot users (Izaan, EM,      → Coming Soon placeholder
 *    Etsy partners)                          (CEO validates verdicts first)
 *  - Everyone else                        → redirect to /dashboard
 */
export default async function ReverseHuntPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (session.user.role === "SUPER_ADMIN") {
    return <ReverseHuntView isCeo={true} />;
  }

  // Anyone with SEO Autopilot access (Izaan, EM, Etsy partners) sees
  // a tailored Coming Soon; everyone else gets bounced.
  const access = await getSeoAutopilotAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) {
    redirect("/dashboard");
  }

  return <ReverseHuntComingSoon />;
}
