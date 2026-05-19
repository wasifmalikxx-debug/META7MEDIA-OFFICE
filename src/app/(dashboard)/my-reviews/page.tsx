import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { ReviewBonusSubmit } from "@/components/review-bonus/review-bonus-submit";

export const dynamic = "force-dynamic";

/**
 * /my-reviews — personal review-bonus submission page.
 *
 * Built for users who manage a team AND own shops (today: Izaan, EM-4).
 * Regular shop-owner employees use /review-bonus for their own submit
 * view; Izaan's /review-bonus is the manager approval inbox, so his
 * personal submit lives here on its own page.
 *
 * Access:
 *  - SUPER_ADMIN, HR_ADMIN, PARTNER → redirect to /review-bonus
 *    (they don't own shops, no personal submit needed)
 *  - Izaan (MANAGER + EM-4)        → this page
 *  - Anyone else                    → redirect to /review-bonus
 *    (their employee submit view already lives there)
 */
export default async function MyReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as { id: string; role: string; employeeId?: string };

  const isIzaan = user.role === "MANAGER" && user.employeeId === "EM-4";
  if (!isIzaan) {
    redirect("/review-bonus");
  }

  const params = await searchParams;
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : pkt.getUTCFullYear();

  // Izaan's own submissions for the current PKT month. Same shape as
  // /review-bonus uses for employees.
  const submissions = await prisma.reviewBonus.findMany({
    where: { userId: user.id, month, year },
    include: {
      approvedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submit Review"
        description="Submit fixed reviews from your own shops for the Rs. 500 per-review bonus. CEO approves your claims."
      />
      <ReviewBonusSubmit
        submissions={JSON.parse(JSON.stringify(submissions))}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
