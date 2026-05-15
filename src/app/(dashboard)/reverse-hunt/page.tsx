import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReverseHuntView } from "@/components/reverse-hunt/reverse-hunt-view";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

export const dynamic = "force-dynamic";

/**
 * /reverse-hunt — Play 2.
 *
 * Paste an AliExpress URL → get an Etsy demand verdict + projected margin.
 * Same access policy as SEO Autopilot: CEO + Izaan + EM + Etsy partners.
 */
export default async function ReverseHuntPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const access = await getSeoAutopilotAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) {
    redirect("/dashboard");
  }

  return <ReverseHuntView isCeo={access.isCeo} />;
}
