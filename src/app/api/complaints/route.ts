import { NextRequest } from "next/server";
import { json, error, requireAuth, isAllowedImageDataUrl } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { notifyAdmins, createNotification } from "@/lib/services/notification.service";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["BUG", "PAYROLL", "ATTENDANCE", "HR", "POLICY", "TECHNICAL", "HARASSMENT", "OTHER"] as const;
const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// GET /api/complaints — list complaints (with message count)
export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN" || role === "HR_ADMIN";
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");
  const categoryFilter = searchParams.get("category");

  const where: any = {};
  if (!isAdmin) {
    where.userId = session.user.id;
  }
  if (statusFilter) where.status = statusFilter;
  if (categoryFilter) where.category = categoryFilter;

  const complaints = await prisma.complaint.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      resolvedBy: { select: { firstName: true, lastName: true } },
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { message: true, senderRole: true, createdAt: true },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return json(complaints);
}

// POST /api/complaints — submit a new complaint (creates initial message)
export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const body = await request.json();
    const subject = String(body.subject || "").trim();
    const description = String(body.description || "").trim();
    const category = String(body.category || "").trim();
    const priority = String(body.priority || "MEDIUM").trim();
    const imageUrl = body.imageUrl ? String(body.imageUrl) : null;

    if (!subject || subject.length < 3) {
      return error("Subject must be at least 3 characters");
    }
    if (!description || description.length < 10) {
      return error("Please describe the issue in at least 10 characters");
    }
    if (!VALID_CATEGORIES.includes(category as any)) {
      return error("Invalid category");
    }
    if (!VALID_PRIORITIES.includes(priority as any)) {
      return error("Invalid priority");
    }
    if (imageUrl && !isAllowedImageDataUrl(imageUrl)) {
      return error("Only JPG, PNG, WEBP or GIF images under 9MB are allowed");
    }

    const role = (session.user as any).role;
    const isCeo = role === "SUPER_ADMIN" || role === "HR_ADMIN";

    // CEO/HR can launch a complaint AGAINST an employee by passing
    // targetUserId. The complaint's userId is the target (so the employee
    // sees it as theirs in their inbox), the first message is from CEO,
    // and unread flips to the employee. Employees who pass targetUserId
    // are silently ignored — they can only complain about themselves to
    // the CEO direction.
    const targetUserId = isCeo && body.targetUserId ? String(body.targetUserId).trim() : "";
    const isCeoLaunch = isCeo && targetUserId && targetUserId !== session.user.id;

    let complaintUserId = session.user.id;
    let firstSenderRole: "CEO" | "EMPLOYEE" = isCeo ? "CEO" : "EMPLOYEE";
    let unreadByCeoInit = true;
    let unreadByEmployeeInit = false;

    if (isCeoLaunch) {
      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, role: true, status: true, firstName: true, lastName: true, employeeId: true },
      });
      if (!target) return error("Target employee not found", 404);
      if (target.role === "SUPER_ADMIN" || target.role === "HR_ADMIN") {
        return error("Cannot launch a complaint against an admin", 400);
      }
      if (target.status === "RESIGNED") {
        return error("Cannot launch a complaint against a resigned employee", 400);
      }
      complaintUserId = target.id;
      firstSenderRole = "CEO";
      unreadByCeoInit = false;
      unreadByEmployeeInit = true;
    }

    const now = nowPKT();
    const complaint = await prisma.complaint.create({
      data: {
        userId: complaintUserId,
        subject,
        description,
        category: category as any,
        priority: priority as any,
        status: "OPEN",
        unreadByCeo: unreadByCeoInit,
        unreadByEmployee: unreadByEmployeeInit,
        createdAt: now,
        updatedAt: now,
        messages: {
          create: {
            senderId: session.user.id,
            senderRole: firstSenderRole,
            message: description,
            imageUrl,
            createdAt: now,
          },
        },
      },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        messages: true,
      },
    });

    const employeeName = `${complaint.user.firstName} ${complaint.user.lastName || ""}`.trim();
    if (isCeoLaunch) {
      // Notify the target employee — CEO has opened a thread to them.
      await createNotification(
        complaintUserId,
        "COMPLAINT_SUBMITTED",
        `New message from CEO: ${subject}`,
        `The CEO opened a ${priority.toLowerCase()} priority ${category.toLowerCase()} complaint.`,
        "/complaints",
      );
    } else {
      // Standard employee → CEO complaint. Notify admins as before.
      await notifyAdmins(
        "COMPLAINT_SUBMITTED",
        `New Complaint: ${subject}`,
        `${employeeName} (${complaint.user.employeeId}) submitted a ${priority} priority ${category} complaint.`,
        "/complaints",
      );
    }

    return json(complaint);
  } catch (err: any) {
    return error(err.message || "Failed to submit complaint", 500);
  }
}
