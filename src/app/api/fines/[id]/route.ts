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
  const fine = await prisma.fine.findUnique({ where: { id } });
  if (!fine) return error("Fine not found", 404);

  await prisma.fine.delete({ where: { id } });

  // Sync payroll record after fine removal
  try {
    const { syncPayrollRecord } = await import("@/lib/services/payroll-sync.service");
    await syncPayrollRecord(fine.userId, fine.month, fine.year);
  } catch {}

  return json({ success: true });
}
