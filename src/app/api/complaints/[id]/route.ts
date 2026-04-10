import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { createNotification } from "@/lib/services/notification.service";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["OPEN", "IN_PROGRESS", "APPROVED", "RESOLVED", "DENIED"] as const;

// GET /api/complaints/[id] — get single complaint
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN" || role === "HR_ADMIN";

  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      respondedBy: { select: { firstName: true, lastName: true } },
    },
  });

  if (!complaint) return error("Not found", 404);
  if (!isAdmin && complaint.userId !== session.user.id) {
    return error("Forbidden", 403);
  }

  return json(complaint);
}

// PATCH /api/complaints/[id] — CEO updates status/response
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN" || role === "HR_ADMIN";
  if (!isAdmin) return error("Forbidden — CEO only", 403);

  const { id } = await params;
  const body = await request.json();

  const existing = await prisma.complaint.findUnique({ where: { id } });
  if (!existing) return error("Not found", 404);

  const updateData: any = { updatedAt: nowPKT() };
  let statusChanged = false;
  let responseAdded = false;

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) return error("Invalid status");
    if (body.status !== existing.status) {
      updateData.status = body.status;
      statusChanged = true;
      if (body.status === "RESOLVED" || body.status === "DENIED") {
        updateData.resolvedAt = nowPKT();
      }
    }
  }

  if (body.ceoResponse !== undefined) {
    const trimmed = String(body.ceoResponse).trim();
    if (trimmed) {
      updateData.ceoResponse = trimmed;
      updateData.respondedById = session.user.id;
      updateData.respondedAt = nowPKT();
      responseAdded = true;
    }
  }

  const updated = await prisma.complaint.update({
    where: { id },
    data: updateData,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      respondedBy: { select: { firstName: true, lastName: true } },
    },
  });

  // Notify employee of update
  if (statusChanged || responseAdded) {
    const statusLabel = updated.status.replace("_", " ").toLowerCase();
    await createNotification(
      existing.userId,
      responseAdded ? "COMPLAINT_RESPONDED" : "COMPLAINT_STATUS_CHANGED",
      responseAdded ? "CEO responded to your complaint" : `Your complaint is now ${statusLabel}`,
      `"${existing.subject}"${responseAdded ? " — CEO has left a response" : ""}`,
      "/complaints"
    );
  }

  return json(updated);
}

// DELETE /api/complaints/[id] — employee can delete their own if still OPEN
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN" || role === "HR_ADMIN";

  const existing = await prisma.complaint.findUnique({ where: { id } });
  if (!existing) return error("Not found", 404);

  // Employee: can only delete own OPEN complaints
  if (!isAdmin) {
    if (existing.userId !== session.user.id) return error("Forbidden", 403);
    if (existing.status !== "OPEN") {
      return error("Cannot delete — complaint has already been reviewed");
    }
  }

  await prisma.complaint.delete({ where: { id } });
  return json({ success: true });
}
