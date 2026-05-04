import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { notifyAdmins } from "@/lib/services/notification.service";

export const dynamic = "force-dynamic";

// Access rules (post multi-office, May 2026):
//   - CEO (SUPER_ADMIN / HR_ADMIN)        → all refunds
//   - Izaan (EM-4, MANAGER)                → all refunds
//   - PARTNER (Awais / Mubeen / Zain)      → only their team members' refunds
//   - Etsy-style shop owners (EM-*/AE-*/ME-*, NOT EM-4)
//                                          → only their own refunds, can submit
//   - Anyone else                          → forbidden
function canSeeAllUnscoped(user: { role?: string; employeeId?: string }) {
  return user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN" || user.employeeId === "EM-4";
}

function canSubmit(user: { employeeId?: string }) {
  // Etsy-style shop owners across all offices, except the EM team lead Izaan.
  // Pre multi-office this only included EM-*; AE-* and ME-* are Awais's and
  // Mubeen's teams added in May 2026.
  if (!user.employeeId) return false;
  if (user.employeeId === "EM-4") return false;
  return (
    user.employeeId.startsWith("EM") ||
    user.employeeId.startsWith("AE") ||
    user.employeeId.startsWith("ME")
  );
}

// GET /api/refunds — list refunds (scoped by role)
export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const user = session.user as any;
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  const year = searchParams.get("year");

  const where: any = {};

  // Apply month window if provided (shared across all access paths).
  if (month && year) {
    const m = parseInt(month);
    const y = parseInt(year);
    where.createdAt = {
      gte: new Date(Date.UTC(y, m - 1, 1)),
      lt: new Date(Date.UTC(y, m, 1)),
    };
  }

  if (canSeeAllUnscoped(user)) {
    // Admin / Izaan — no userId filter.
  } else if (user.role === "PARTNER") {
    // PARTNER — scope to their team members. Empty team surfaces empty list
    // rather than leaking other partners' refunds.
    const teams = await prisma.team.findMany({
      where: { partnerId: user.id },
      select: { members: { select: { id: true } } },
    });
    const memberIds = teams.flatMap((t) => t.members.map((m) => m.id));
    where.userId = { in: memberIds.length > 0 ? memberIds : ["__none__"] };
  } else if (canSubmit(user)) {
    // Etsy-style employee — own only.
    where.userId = user.id;
  } else {
    return error("Forbidden", 403);
  }

  const refunds = await prisma.refund.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json(refunds);
}

// POST /api/refunds — submit a new refund (Etsy employees only)
export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const user = session.user as any;
  if (!canSubmit(user)) {
    return error("Only Etsy team members can submit refunds", 403);
  }

  try {
    const body = await request.json();
    const storeName = String(body.storeName || "").trim();
    const customerName = String(body.customerName || "").trim();
    const etsyRefundAmount = parseFloat(body.etsyRefundAmount);
    const aliexpressRefunded = !!body.aliexpressRefunded;
    const aliexpressAmount = body.aliexpressAmount != null ? parseFloat(body.aliexpressAmount) : null;
    const aliexpressProofUrl = body.aliexpressProofUrl ? String(body.aliexpressProofUrl) : null;
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
      if (!aliexpressProofUrl) {
        return error("Screenshot proof is required when AliExpress refund is marked as Yes");
      }
      if (!aliexpressProofUrl.startsWith("data:image/")) {
        return error("Invalid screenshot format");
      }
    } else {
      // When AliExpress refund was NOT applied, require a detailed explanation
      if (!notes || notes.length < 10) {
        return error(
          "Please explain why the refund was not applied on AliExpress (at least 10 characters)"
        );
      }
    }

    const now = nowPKT();
    const refund = await prisma.refund.create({
      data: {
        userId: user.id,
        storeName,
        customerName,
        etsyRefundAmount,
        aliexpressRefunded,
        aliexpressAmount: aliexpressRefunded ? aliexpressAmount : null,
        aliexpressProofUrl: aliexpressRefunded ? aliexpressProofUrl : null,
        notes,
        createdAt: now,
        updatedAt: now,
      },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
    });

    // Notify CEO + HR + Izaan (manager) when a refund is submitted
    const employeeName = `${refund.user.firstName} ${refund.user.lastName || ""}`.trim();
    await notifyAdmins(
      "GENERAL",
      "New refund submitted",
      `${employeeName} (${refund.user.employeeId}) submitted a $${etsyRefundAmount} refund for ${storeName} — ${customerName}`,
      "/refunds"
    );
    // Also notify Izaan directly if he isn't already a notifyAdmins recipient
    const izaan = await prisma.user.findFirst({
      where: { employeeId: "EM-4" },
      select: { id: true, role: true },
    });
    if (izaan && izaan.role !== "SUPER_ADMIN" && izaan.role !== "HR_ADMIN") {
      const { createNotification } = await import("@/lib/services/notification.service");
      await createNotification(
        izaan.id,
        "GENERAL",
        "New refund submitted",
        `${employeeName} (${refund.user.employeeId}) — $${etsyRefundAmount} refund for ${storeName}`,
        "/refunds"
      );
    }

    return json(refund);
  } catch (err: any) {
    return error(err.message || "Failed to submit refund", 500);
  }
}
