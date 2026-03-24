import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const announcements = await prisma.announcement.findMany({
    where: { isActive: true },
    include: {
      author: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json(announcements);
}

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN", "HR_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const { title, content, priority, expiresAt } = body;

    if (!title || !content) {
      return error("Title and content are required");
    }

    const announcement = await prisma.announcement.create({
      data: {
        title,
        content,
        priority: priority || 0,
        authorId: session.user.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    return json(announcement, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
