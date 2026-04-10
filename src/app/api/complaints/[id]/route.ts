import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { createNotification } from "@/lib/services/notification.service";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["OPEN", "IN_PROGRESS", "APPROVED", "RESOLVED", "DENIED"] as const;

// GET /api/complaints/[id] — get single complaint with full message thread
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN" || role === "HR_ADMIN";

  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
      resolvedBy: { select: { firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          sender: { select: { firstName: true, lastName: true, employeeId: true } },
        },
      },
    },
  });

  if (!complaint) return error("Not found", 404);
  if (!isAdmin && complaint.userId !== session.user.id) {
    return error("Forbidden", 403);
  }

  // Mark as read for the viewer
  if (isAdmin && complaint.unreadByCeo) {
    await prisma.complaint.update({ where: { id }, data: { unreadByCeo: false } });
  } else if (!isAdmin && complaint.unreadByEmployee) {
    await prisma.complaint.update({ where: { id }, data: { unreadByEmployee: false } });
  }

  return json(complaint);
}

// PATCH /api/complaints/[id] — CEO updates status only
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

  if (!VALID_STATUSES.includes(body.status)) return error("Invalid status");
  if (body.status === existing.status) {
    return json({ ...existing, unchanged: true });
  }

  const now = nowPKT();
  const updateData: any = {
    status: body.status,
    updatedAt: now,
    unreadByEmployee: true,
  };

  if (body.status === "RESOLVED" || body.status === "DENIED") {
    updateData.resolvedAt = now;
    updateData.resolvedById = session.user.id;
  } else {
    updateData.resolvedAt = null;
    updateData.resolvedById = null;
  }

  const updated = await prisma.complaint.update({
    where: { id },
    data: updateData,
    include: {
      user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
      resolvedBy: { select: { firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          sender: { select: { firstName: true, lastName: true, employeeId: true } },
        },
      },
    },
  });

  // Notify employee of status change
  const statusLabel = updated.status.replace("_", " ").toLowerCase();
  await createNotification(
    existing.userId,
    "COMPLAINT_STATUS_CHANGED",
    `Complaint marked as ${statusLabel}`,
    `"${existing.subject}"`,
    "/complaints"
  );

  return json(updated);
}

// DELETE /api/complaints/[id] — CEO/HR only
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN" || role === "HR_ADMIN";
  if (!isAdmin) return error("Forbidden — Only CEO can delete complaints", 403);

  const { id } = await params;
  const existing = await prisma.complaint.findUnique({ where: { id } });
  if (!existing) return error("Not found", 404);

  // Messages will cascade delete via the schema relation
  await prisma.complaint.delete({ where: { id } });
  return json({ success: true });
}
