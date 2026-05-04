import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { EtsyAnalyticsView } from "@/components/analytics/etsy-analytics-view";

export const dynamic = "force-dynamic";

export default async function EtsyAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  // CEO + MANAGER (Izaan) view OFFICE 1's Etsy team (EM).
  // Etsy PARTNERs (Awais, Mubeen) view their own team's analytics.
  // Non-Etsy partner (Zain/FB) gets redirected — bonus + analytics aren't his.
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "PARTNER") {
    redirect("/dashboard");
  }

  let pageTitle = "Etsy Analytics";
  let description = "Comprehensive sales analytics across all Etsy employees and shops";

  if (role === "PARTNER") {
    const team = await prisma.team.findFirst({
      where: { partnerId: session.user.id },
      select: { name: true, department: { select: { name: true } } },
    });
    if (!team || !team.department) redirect("/dashboard");
    if (!team.department.name.toLowerCase().includes("etsy")) {
      redirect("/dashboard");
    }
    pageTitle = `${team.department.name} Analytics`;
    description = `Sales analytics for your ${team.name}`;
  }

  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = pkt.getUTCMonth() + 1;
  const year = pkt.getUTCFullYear();

  return (
    <div className="space-y-6">
      <PageHeader title={pageTitle} description={description} />
      <EtsyAnalyticsView initialMonth={month} initialYear={year} />
    </div>
  );
}
