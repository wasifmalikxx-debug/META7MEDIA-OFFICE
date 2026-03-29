import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { pktMonth, pktYear } from "@/lib/pkt";
import { reviewBonusSubmitSchema } from "@/lib/validations/bonus";
import { createNotification, notifyAdmins } from "@/lib/services/notification.service";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  const { searchParams } = new URL(request.url);
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(_pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(_pkt.getUTCFullYear()));
  const status = searchParams.get("status"); // PENDING | APPROVED | REJECTED

  const where: any = { month, year };

  if (role === "EMPLOYEE") {
    where.userId = session.user.id;
  }

  if (status) {
    where.status = status;
  }

  // If count=true, return just the count (used for sidebar badge)
  const countOnly = searchParams.get("count") === "true";
  if (countOnly) {
    const count = await prisma.reviewBonus.count({ where });
    return json({ count });
  }

  const submissions = await prisma.reviewBonus.findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          employeeId: true,
        },
      },
      approvedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json(submissions);
}

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  if (role !== "EMPLOYEE") {
    return error("Only employees can submit review bonuses", 403);
  }

  try {
    const body = await request.json();
    const parsed = reviewBonusSubmitSchema.parse(body);

    const submission = await prisma.reviewBonus.create({
      data: {
        userId: session.user.id,
        month: pktMonth(),
        year: pktYear(),
        storeName: parsed.storeName,
        customerName: parsed.customerName || null,
        originalRating: parsed.originalRating,
        newRating: parsed.newRating,
        beforeScreenshot: parsed.beforeScreenshot,
        afterScreenshot: parsed.afterScreenshot,
        amount: 500, // Rs. 500 per review bonus
      },
    });

    // Notify managers / admins
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true },
    });
    const empName = user ? `${user.firstName} ${user.lastName || ""}`.trim() : "Employee";

    await notifyAdmins(
      "REVIEW_BONUS_SUBMITTED",
      "Review Bonus Submitted",
      `${empName} submitted a review bonus claim for store "${parsed.storeName}" (${parsed.originalRating}★ → ${parsed.newRating}★).`,
      "/review-bonus"
    );

    // Also notify the employee's manager if they have one
    const fullUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { managerId: true },
    });
    if (fullUser?.managerId) {
      await createNotification(
        fullUser.managerId,
        "REVIEW_BONUS_SUBMITTED",
        "Review Bonus Submitted",
        `${empName} submitted a review bonus claim for store "${parsed.storeName}".`,
        "/review-bonus"
      );
    }

    return json(submission, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
