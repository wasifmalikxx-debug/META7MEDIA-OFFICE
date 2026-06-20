import { NextRequest } from "next/server";
import { json, error, requireAuth, isAllowedImageDataUrl } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";

export const dynamic = "force-dynamic";

// Only true admins (CEO / HR) bypass the department scope. MANAGER (Izaan)
// is scoped per-action below — he can delete refunds from his own department
// only, NOT from Awais's AE team or Mubeen's ME team.
function isAdmin(user: { role?: string }) {
  return user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";
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

// GET /api/refunds/[id] — full refund record including the proof image URL.
// Used by the list view to LAZY-load proof images on demand. The list query
// itself omits aliexpressProofUrl (base64 data URLs ~50KB each blow up the
// payload to ~1MB+ and slow the page to 5+ seconds), so when the CEO clicks
// "View Proof" we fetch just that one refund's proof here.
//
// Scope mirrors DELETE: CEO/HR see any refund, MANAGER (Izaan) only own
// department, owner sees own. Anyone else 403s.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const user = session.user as any;
  const { id } = await params;

  const refund = await prisma.refund.findUnique({
    where: { id },
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true, departmentId: true } },
    },
  });
  if (!refund) return error("Not found", 404);

  const userIsAdmin = isAdmin(user);
  const isManager = user.role === "MANAGER";
  const isOwner = refund.userId === user.id;
  const isPartner = user.role === "PARTNER";

  if (userIsAdmin || isOwner) {
    // Full access — proceed.
  } else if (isManager) {
    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { departmentId: true },
    });
    if (!me?.departmentId || me.departmentId !== refund.user.departmentId) {
      return error("Forbidden", 403);
    }
  } else if (isPartner) {
    // Partner can read their own team's refunds.
    const teams = await prisma.team.findMany({
      where: { partnerId: user.id },
      select: { members: { where: { id: refund.userId }, select: { id: true } } },
    });
    const isOnPartnerTeam = teams.some((t) => t.members.length > 0);
    if (!isOnPartnerTeam) return error("Forbidden", 403);
  } else {
    return error("Forbidden", 403);
  }

  // Strip departmentId (only needed for the scope check above).
  const { user: u, ...rest } = refund;
  return json({
    ...rest,
    user: { firstName: u.firstName, lastName: u.lastName, employeeId: u.employeeId },
  });
}

// PATCH /api/refunds/[id] — ONLY the owner can edit, and only within 15 minutes.
// Admins (CEO / Izaan) can NOT edit — they can only delete via the DELETE route.
// This keeps refund records authoritative to the employee who submitted them.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const user = session.user as any;
  const { id } = await params;

  const existing = await prisma.refund.findUnique({ where: { id } });
  if (!existing) return error("Not found", 404);

  if (existing.userId !== user.id) {
    return error("Only the employee who submitted this refund can edit it", 403);
  }
  const elapsed = minutesSinceCreation(existing.createdAt);
  if (elapsed > 15) {
    return error("You can only edit a refund within 15 minutes of submitting it");
  }

  try {
    const body = await request.json();
    const storeName = String(body.storeName || "").trim();
    const customerName = String(body.customerName || "").trim();
    const etsyRefundAmount = parseFloat(body.etsyRefundAmount);
    const aliexpressRefunded = !!body.aliexpressRefunded;
    const aliexpressAmount = body.aliexpressAmount != null ? parseFloat(body.aliexpressAmount) : null;
    // Two possibilities for proof:
    //  1. Employee uploaded a NEW image → body.aliexpressProofUrl is a data: URL
    //  2. Employee kept the existing image → client sends body.keepExistingProof = true
    const newProofUrl = body.aliexpressProofUrl ? String(body.aliexpressProofUrl) : null;
    const keepExistingProof = !!body.keepExistingProof;
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!storeName || storeName.length < 2) return error("Store name is required");
    if (!customerName || customerName.length < 2) return error("Customer name is required");
    if (isNaN(etsyRefundAmount) || etsyRefundAmount <= 0) {
      return error("Etsy refund amount must be greater than 0");
    }

    let aliexpressProofUrl: string | null = null;
    if (aliexpressRefunded) {
      if (aliexpressAmount == null || isNaN(aliexpressAmount) || aliexpressAmount <= 0) {
        return error("AliExpress refund amount is required when marked as refunded");
      }
      if (newProofUrl) {
        if (!isAllowedImageDataUrl(newProofUrl)) {
          return error("Screenshot must be a JPG/PNG/WEBP/GIF image under 9MB");
        }
        aliexpressProofUrl = newProofUrl;
      } else if (keepExistingProof && existing.aliexpressProofUrl) {
        aliexpressProofUrl = existing.aliexpressProofUrl;
      } else {
        return error("Screenshot proof is required when AliExpress refund is marked as Yes");
      }
    } else {
      // When AliExpress refund was NOT applied, require a detailed explanation
      if (!notes || notes.length < 10) {
        return error(
          "Please explain why the refund was not applied on AliExpress (at least 10 characters)"
        );
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
        aliexpressProofUrl,
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

// DELETE /api/refunds/[id]
//   - CEO / HR_ADMIN  → can delete any refund
//   - MANAGER (Izaan)  → can delete refunds from employees in his own
//                        department (Etsy - EM) only — NOT AE-/ME-/SMM-
//   - Owner            → can delete own within 15 min of creation
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const user = session.user as any;
  const { id } = await params;

  const existing = await prisma.refund.findUnique({ where: { id } });
  if (!existing) return error("Not found", 404);

  const userIsAdmin = isAdmin(user);
  const isManager = user.role === "MANAGER";
  const isOwner = existing.userId === user.id;

  if (userIsAdmin) {
    // Full access — proceed.
  } else if (isManager && !isOwner) {
    // Scope check: submitter must be in the manager's own department.
    // The `!isOwner` guard stops Izaan from bypassing the owner 15-min
    // window for his OWN submissions now that he runs shops himself.
    // For his own refunds he falls through to the isOwner branch below
    // and gets the same time-limited delete every other shop owner has.
    const [me, submitter] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { departmentId: true } }),
      prisma.user.findUnique({ where: { id: existing.userId }, select: { departmentId: true } }),
    ]);
    if (!me?.departmentId || me.departmentId !== submitter?.departmentId) {
      return error("Forbidden — you can only delete refunds from your own department", 403);
    }
  } else if (isOwner) {
    const elapsed = minutesSinceCreation(existing.createdAt);
    if (elapsed > 15) {
      return error("You can only delete a refund within 15 minutes of submitting it");
    }
  } else {
    return error("Forbidden", 403);
  }

  await prisma.refund.delete({ where: { id } });
  return json({ success: true });
}
