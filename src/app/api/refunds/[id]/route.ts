import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function canSeeAll(user: { role?: string; employeeId?: string }) {
  return user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN" || user.employeeId === "EM-4";
}

// DELETE /api/refunds/[id] — employee can delete own within 15 min, admin/manager always
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const user = session.user as any;
  const { id } = await params;

  const existing = await prisma.refund.findUnique({ where: { id } });
  if (!existing) return error("Not found", 404);

  const isAdminOrManager = canSeeAll(user);
  const isOwner = existing.userId === user.id;

  if (!isAdminOrManager) {
    if (!isOwner) return error("Forbidden", 403);
    // Employees can only delete their own refund within 15 minutes of submission
    const minutesSince = Math.floor((Date.now() - new Date(existing.createdAt).getTime()) / 60000);
    if (minutesSince > 15) {
      return error("You can only delete a refund within 15 minutes of submitting it");
    }
  }

  await prisma.refund.delete({ where: { id } });
  return json({ success: true });
}
