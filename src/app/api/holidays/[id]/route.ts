import { NextRequest } from "next/server";
import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;

  await prisma.holiday.delete({ where: { id } });
  return json({ success: true });
}
