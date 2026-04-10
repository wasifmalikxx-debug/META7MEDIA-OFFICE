import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// GET /api/notifications/unread-count
// Returns just the unread count for the current user. Cheap to call from
// a polling header bell — avoids dragging back the whole notification list.
export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const count = await prisma.notification.count({
      where: { userId: session.user.id, isRead: false },
    });
    return json({ count });
  } catch (err: any) {
    return error(err.message || "Failed to fetch unread count", 500);
  }
}
