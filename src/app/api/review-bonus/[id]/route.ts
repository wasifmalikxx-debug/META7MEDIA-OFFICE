import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { reviewBonusActionSchema } from "@/lib/validations/bonus";
import { createNotification } from "@/lib/services/notification.service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    return error("Forbidden", 403);
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = reviewBonusActionSchema.parse(body);

    const submission = await prisma.reviewBonus.findUnique({
      where: { id },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!submission) return error("Review bonus not found", 404);
    if (submission.status !== "PENDING") {
      return error("This submission has already been processed");
    }

    const updated = await prisma.reviewBonus.update({
      where: { id },
      data: {
        status: parsed.action,
        approvedById: session.user.id,
        approvedAt: new Date(),
        rejectionReason: parsed.rejectionReason || null,
      },
    });

    const empName = submission.user
      ? `${submission.user.firstName} ${submission.user.lastName || ""}`.trim()
      : "Employee";

    if (parsed.action === "APPROVED") {
      // Create an Incentive record so it flows into payroll
      const now = new Date();
      await prisma.incentive.create({
        data: {
          userId: submission.userId,
          type: "MANUAL",
          amount: submission.amount, // Rs. 500
          reason: `Bad Review Fix Bonus - ${submission.storeName}`,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          givenById: session.user.id,
        },
      });

      await createNotification(
        submission.userId,
        "REVIEW_BONUS_APPROVED",
        "Review Bonus Approved",
        `Your review bonus for store "${submission.storeName}" has been approved! PKR ${submission.amount.toLocaleString()} will be added to your payroll.`,
        "/review-bonus"
      );

      // WhatsApp notification
      const { notifyEmployee, incentiveAwardedMsg } = await import(
        "@/lib/services/whatsapp.service"
      );
      notifyEmployee(
        submission.userId,
        incentiveAwardedMsg(empName, submission.amount, `Bad Review Fix Bonus - ${submission.storeName}`)
      );
    } else {
      await createNotification(
        submission.userId,
        "REVIEW_BONUS_REJECTED",
        "Review Bonus Rejected",
        `Your review bonus for store "${submission.storeName}" has been rejected.${parsed.rejectionReason ? ` Reason: ${parsed.rejectionReason}` : ""}`,
        "/review-bonus"
      );
    }

    return json(updated);
  } catch (err: any) {
    return error(err.message);
  }
}
