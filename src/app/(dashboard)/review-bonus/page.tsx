import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { ReviewBonusSubmit } from "@/components/review-bonus/review-bonus-submit";
import { ReviewBonusManager } from "@/components/review-bonus/review-bonus-manager";

export default async function ReviewBonusPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const userId = session.user.id;
  const isManagerOrAdmin = role === "SUPER_ADMIN" || role === "MANAGER";

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  if (isManagerOrAdmin) {
    // Managers/Admins see all submissions
    const submissions = await prisma.reviewBonus.findMany({
      where: { month, year },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="space-y-6">
        <PageHeader
          title="Review Approvals"
          description="Approve or reject employee review bonus submissions"
        />
        <ReviewBonusManager
          submissions={JSON.parse(JSON.stringify(submissions))}
          currentMonth={month}
          currentYear={year}
        />
      </div>
    );
  }

  // Employees see their own submissions + submit form
  const mySubmissions = await prisma.reviewBonus.findMany({
    where: { userId },
    include: {
      approvedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submit Review"
        description="Submit fixed reviews for Rs. 500 bonus per review"
      />
      <ReviewBonusSubmit
        submissions={JSON.parse(JSON.stringify(mySubmissions))}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
