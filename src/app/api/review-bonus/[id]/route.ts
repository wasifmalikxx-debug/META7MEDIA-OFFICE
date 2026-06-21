import { NextRequest } from "next/server";
import { json, error, requireAuth, getCallerScope, assertCanActOnUser } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT, formatPKTDate } from "@/lib/pkt";
import { reviewBonusActionSchema } from "@/lib/validations/bonus";
import { createNotification } from "@/lib/services/notification.service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "PARTNER") {
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

    // Self-approval guard. Izaan now submits review-bonus claims for his
    // own shops (May 19 2026), so without this check his MANAGER role
    // would let him approve/reject his own PENDING submissions and pay
    // himself out. CEO/HR approve his claims via the SUPER_ADMIN branch
    // below. Applies to all roles defensively — a partner couldn't end
    // up submitting their own anyway (role check at POST), but cheaper
    // to enforce here than reason about every future role change.
    if (submission.userId === session.user.id) {
      return error(
        "You can't approve or reject your own review-bonus submission — the CEO will handle it.",
        403,
      );
    }

    // PARTNER scope: target submission's user must be on one of the
    // partner's teams. CEO passes without scope check (sees everything).
    // MANAGER (Izaan) scope: target submission's user must be in his own
    // department (Etsy - EM). He cannot approve/reject AE-/ME- submissions.
    if (role === "PARTNER") {
      const scope = await getCallerScope(session);
      if (!scope) return error("Forbidden", 403);
      const denied = await assertCanActOnUser(scope, submission.userId);
      if (denied) return denied;
    } else if (role === "MANAGER") {
      const [me, submitter] = await Promise.all([
        prisma.user.findUnique({ where: { id: session.user.id }, select: { departmentId: true } }),
        prisma.user.findUnique({ where: { id: submission.userId }, select: { departmentId: true } }),
      ]);
      if (!me?.departmentId || me.departmentId !== submitter?.departmentId) {
        return error("Forbidden — you can only act on your own department's submissions", 403);
      }
    }

    // M15: check PROBATION BEFORE flipping the status, so a probation approval
    // can never leave an APPROVED-but-unpaid row. The old code updated status to
    // APPROVED first, then returned an error for probation employees — leaving
    // the record corrupted (shows APPROVED, no incentive ever created).
    if (parsed.action === "APPROVED") {
      const emp = await prisma.user.findUnique({ where: { id: submission.userId }, select: { status: true } });
      if (emp?.status === "PROBATION") {
        return error("Probation employees are not eligible for incentives.");
      }
    }

    const updated = await prisma.reviewBonus.update({
      where: { id },
      data: {
        status: parsed.action,
        approvedById: session.user.id,
        approvedAt: nowPKT(),
        rejectionReason: parsed.rejectionReason || null,
      },
    });

    const empName = submission.user
      ? `${submission.user.firstName} ${submission.user.lastName || ""}`.trim()
      : "Employee";

    if (parsed.action === "APPROVED") {
      // Create an Incentive record so it flows into payroll
      await prisma.incentive.create({
        data: {
          userId: submission.userId,
          type: "MANUAL",
          amount: submission.amount, // Rs. 500
          reason: `Bad Review Fix Bonus - ${submission.storeName}`,
          month: submission.month,
          year: submission.year,
          givenById: session.user.id,
        },
      });

      // Sync payroll with new incentive
      try {
        const { syncPayrollRecord } = await import("@/lib/services/payroll-sync.service");
        await syncPayrollRecord(submission.userId, submission.month, submission.year);
      } catch {}

      await createNotification(
        submission.userId,
        "REVIEW_BONUS_APPROVED",
        "Review Bonus Approved",
        `Your review bonus for store "${submission.storeName}" has been approved! PKR ${submission.amount.toLocaleString()} will be added to your payroll.`,
        "/review-bonus"
      );

      // WhatsApp removed — only fines & salary paid get notifications
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const submission = await prisma.reviewBonus.findUnique({ where: { id } });
  if (!submission) return error("Not found", 404);

  if (submission.userId !== session.user.id) {
    return error("You can only edit your own submissions", 403);
  }
  if (submission.status !== "PENDING") {
    return error("Can only edit pending submissions", 400);
  }
  const minutesSinceCreated = Math.floor((Date.now() - submission.createdAt.getTime()) / 60000);
  if (minutesSinceCreated > 2) {
    return error("Submissions can only be edited within 2 minutes", 400);
  }

  try {
    const body = await request.json();
    const updateData: any = {};
    if (body.storeName) updateData.storeName = body.storeName;
    if (body.customerName !== undefined) updateData.customerName = body.customerName || null;
    if (body.originalRating) updateData.originalRating = body.originalRating;
    if (body.newRating) updateData.newRating = body.newRating;
    if (body.beforeScreenshot) updateData.beforeScreenshot = body.beforeScreenshot;
    if (body.afterScreenshot) updateData.afterScreenshot = body.afterScreenshot;

    const updated = await prisma.reviewBonus.update({
      where: { id },
      data: updateData,
    });
    return json(updated);
  } catch (err: any) {
    return error(err.message);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const role = (session.user as any).role;
  const submission = await prisma.reviewBonus.findUnique({ where: { id } });
  if (!submission) return error("Not found", 404);

  // PARTNER can approve/reject (PATCH) but NOT delete — user explicitly scoped
  // partner permissions to "accept reviews not submit". Delete (which reverses
  // the Incentive on already-APPROVED reviews) stays CEO + MANAGER only.
  const isAdminOrManager = role === "SUPER_ADMIN" || role === "MANAGER";

  if (isAdminOrManager) {
    // CEO/Manager can delete any submission and reverse incentive
    if (submission.status === "APPROVED") {
      // Remove the associated incentive
      await prisma.incentive.deleteMany({
        where: {
          userId: submission.userId,
          month: submission.month,
          year: submission.year,
          // L13: match the EXACT review-fix-bonus reason this submission
          // created (see the approval path: `Bad Review Fix Bonus - <store>`).
          // The old `contains: storeName` could also wipe unrelated incentives
          // whose reason merely mentioned the store name (e.g. a profit bonus).
          reason: `Bad Review Fix Bonus - ${submission.storeName}`,
        },
      });
      // Sync payroll after incentive removal
      try {
        const { syncPayrollRecord } = await import("@/lib/services/payroll-sync.service");
        await syncPayrollRecord(submission.userId, submission.month, submission.year);
      } catch {}
    }
    // Soft-delete: mark as REMOVED (keeps audit trail)
    await prisma.reviewBonus.update({
      where: { id },
      data: { status: "REMOVED", rejectionReason: `Removed by ${role === "SUPER_ADMIN" ? "CEO" : "Manager"} on ${formatPKTDate(nowPKT())}` },
    });
    return json({ success: true });
  }

  // Employee: can only delete own pending submissions within 2 minutes
  if (submission.userId !== session.user.id) {
    return error("You can only delete your own submissions", 403);
  }
  if (submission.status !== "PENDING") {
    return error("Can only delete pending submissions", 400);
  }
  const minutesSinceCreated = Math.floor((Date.now() - submission.createdAt.getTime()) / 60000);
  if (minutesSinceCreated > 2) {
    return error("Submissions can only be deleted within 2 minutes of submitting", 400);
  }

  await prisma.reviewBonus.delete({ where: { id } });
  return json({ success: true });
}
