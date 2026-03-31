import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return json(notifications);
  } catch (err: any) {
    return error(err.message || "Failed to fetch notifications", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const body = await request.json();

    if (body.markAllRead) {
      await prisma.notification.updateMany({
        where: { userId: session.user.id, isRead: false },
        data: { isRead: true },
      });
      return json({ success: true });
    }

    if (body.id) {
      await prisma.notification.update({
        where: { id: body.id, userId: session.user.id },
        data: { isRead: true },
      });
      return json({ success: true });
    }

    return error("Invalid request");
  } catch (err: any) {
    return error(err.message || "Failed to update notifications", 500);
  }
}
