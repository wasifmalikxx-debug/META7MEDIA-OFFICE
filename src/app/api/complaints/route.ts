import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { notifyAdmins } from "@/lib/services/notification.service";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["BUG", "PAYROLL", "ATTENDANCE", "HR", "POLICY", "TECHNICAL", "HARASSMENT", "OTHER"] as const;
const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// GET /api/complaints — list complaints
// Employees see only their own, admin sees all
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
      respondedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return json(complaints);
}

// POST /api/complaints — submit a new complaint
export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const body = await request.json();
    const subject = String(body.subject || "").trim();
    const description = String(body.description || "").trim();
    const category = String(body.category || "").trim();
    const priority = String(body.priority || "MEDIUM").trim();

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

    const complaint = await prisma.complaint.create({
      data: {
        userId: session.user.id,
        subject,
        description,
        category: category as any,
        priority: priority as any,
        status: "OPEN",
        createdAt: nowPKT(),
        updatedAt: nowPKT(),
      },
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
      },
    });

    // Notify CEO
    const employeeName = `${complaint.user.firstName} ${complaint.user.lastName || ""}`.trim();
    await notifyAdmins(
      "COMPLAINT_SUBMITTED",
      `New Complaint: ${subject}`,
      `${employeeName} (${complaint.user.employeeId}) submitted a ${priority} priority ${category} complaint.`,
      "/complaints"
    );

    return json(complaint);
  } catch (err: any) {
    return error(err.message || "Failed to submit complaint", 500);
  }
}
