import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";

export const dynamic = "force-dynamic";

function canSeeAll(user: { role?: string; employeeId?: string }) {
  return user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN" || user.employeeId === "EM-4";
}

/**
 * Elapsed minutes since the refund was created.
 * Refund createdAt is stored as a PKT-shifted value via nowPKT(), so
 * comparing with Date.now() (real UTC) would be off by 5 hours. Compare
 * against nowPKT() instead so the 15-minute window is accurate.
 */
function minutesSinceCreation(createdAt: Date): number {
  const created = new Date(createdAt).getTime();
  const nowShifted = nowPKT().getTime();
  return Math.floor((nowShifted - created) / 60000);
}

// PATCH /api/refunds/[id] — employee can edit own within 15 min, admin/manager always
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const user = session.user as any;
  const { id } = await params;

  const existing = await prisma.refund.findUnique({ where: { id } });
  if (!existing) return error("Not found", 404);

  const isAdminOrManager = canSeeAll(user);
  const isOwner = existing.userId === user.id;

  if (!isAdminOrManager) {
    if (!isOwner) return error("Forbidden", 403);
    const elapsed = minutesSinceCreation(existing.createdAt);
    if (elapsed > 15) {
      return error("You can only edit a refund within 15 minutes of submitting it");
    }
  }

  try {
    const body = await request.json();
    const storeName = String(body.storeName || "").trim();
    const customerName = String(body.customerName || "").trim();
    const etsyRefundAmount = parseFloat(body.etsyRefundAmount);
    const aliexpressRefunded = !!body.aliexpressRefunded;
    const aliexpressAmount = body.aliexpressAmount != null ? parseFloat(body.aliexpressAmount) : null;
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!storeName || storeName.length < 2) return error("Store name is required");
    if (!customerName || customerName.length < 2) return error("Customer name is required");
    if (isNaN(etsyRefundAmount) || etsyRefundAmount <= 0) {
      return error("Etsy refund amount must be greater than 0");
    }
    if (aliexpressRefunded) {
      if (aliexpressAmount == null || isNaN(aliexpressAmount) || aliexpressAmount <= 0) {
        return error("AliExpress refund amount is required when marked as refunded");
      }
    }

    const updated = await prisma.refund.update({
      where: { id },
      data: {
        storeName,
        customerName,
        etsyRefundAmount,
        aliexpressRefunded,
        aliexpressAmount: aliexpressRefunded ? aliexpressAmount : null,
        notes,
        updatedAt: nowPKT(),
      },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
    });

    return json(updated);
  } catch (err: any) {
    return error(err.message || "Failed to update refund", 500);
  }
}

// DELETE /api/refunds/[id] — employee can delete own within 15 min, admin/manager always
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const user = session.user as any;
  const { id } = await params;

  const existing = await prisma.refund.findUnique({ where: { id } });
  if (!existing) return error("Not found", 404);

  const isAdminOrManager = canSeeAll(user);
  const isOwner = existing.userId === user.id;

  if (!isAdminOrManager) {
    if (!isOwner) return error("Forbidden", 403);
    const elapsed = minutesSinceCreation(existing.createdAt);
    if (elapsed > 15) {
      return error("You can only delete a refund within 15 minutes of submitting it");
    }
  }

  await prisma.refund.delete({ where: { id } });
  return json({ success: true });
}
