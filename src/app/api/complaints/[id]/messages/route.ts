import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { createNotification, notifyAdmins } from "@/lib/services/notification.service";

export const dynamic = "force-dynamic";

// POST /api/complaints/[id]/messages — add a new message to the thread
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { id } = await params;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN" || role === "HR_ADMIN";

  try {
    const body = await request.json();
    const message = String(body.message || "").trim();
    if (!message || message.length < 1) return error("Message cannot be empty");
    if (message.length > 4000) return error("Message too long (max 4000 characters)");

    const complaint = await prisma.complaint.findUnique({
      where: { id },
      select: { id: true, userId: true, subject: true, status: true },
    });
    if (!complaint) return error("Complaint not found", 404);

    // Access check — employee can only message on own complaints
    if (!isAdmin && complaint.userId !== session.user.id) {
      return error("Forbidden", 403);
    }

    // Block messages on closed complaints (resolved/denied)
    if (complaint.status === "RESOLVED" || complaint.status === "DENIED") {
      return error("This complaint is closed. Cannot add messages.");
    }

    const senderRole = isAdmin ? "CEO" : "EMPLOYEE";
    const now = nowPKT();

    // Create the message AND update complaint's unread flags + updatedAt atomically
    const [newMessage] = await prisma.$transaction([
      prisma.complaintMessage.create({
        data: {
          complaintId: id,
          senderId: session.user.id,
          senderRole,
          message,
          createdAt: now,
        },
        include: {
          sender: { select: { firstName: true, lastName: true, employeeId: true } },
        },
      }),
      prisma.complaint.update({
        where: { id },
        data: {
          updatedAt: now,
          // If employee sends, mark unread for CEO; if CEO sends, mark unread for employee
          unreadByCeo: !isAdmin ? true : false,
          unreadByEmployee: isAdmin ? true : false,
          // If CEO replies to an OPEN complaint, auto-move to IN_PROGRESS
          ...(isAdmin && complaint.status === "OPEN" ? { status: "IN_PROGRESS" } : {}),
        },
      }),
    ]);

    // Notifications
    if (isAdmin) {
      await createNotification(
        complaint.userId,
        "COMPLAINT_RESPONDED",
        "CEO replied to your complaint",
        `"${complaint.subject}"`,
        "/complaints"
      );
    } else {
      await notifyAdmins(
        "COMPLAINT_RESPONDED",
        "New message on complaint",
        `"${complaint.subject}"`,
        "/complaints"
      );
    }

    return json(newMessage);
  } catch (err: any) {
    return error(err.message || "Failed to send message", 500);
  }
}
