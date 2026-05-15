import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OpportunityScannerView } from "@/components/seo-autopilot/opportunities-view";

export const dynamic = "force-dynamic";

/**
 * /seo-autopilot/opportunities — CEO-only Etsy niche scanner.
 *
 * Wasif enters a seed product type or keyword. The scanner asks Haiku
 * to brainstorm 25 long-tail variants, then hits Etsy live for each
 * one to gather demand + engagement + shop diversity stats. The
 * highest-scoring "underserved" keywords surface at the top — those
 * are the niches employees should hunt on AliExpress next.
 *
 * Locked to SUPER_ADMIN during the test phase. Once Wasif validates
 * the picks, we can broaden access.
 */
export default async function OpportunitiesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") {
    redirect("/seo-autopilot");
  }
  return <OpportunityScannerView />;
}
