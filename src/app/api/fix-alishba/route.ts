import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// One-time fix: zero out all fines for Alishba Qaiser (new hire)
// DELETE THIS FILE after running
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const alishba = await prisma.user.findFirst({
    where: { firstName: { contains: "Alishba" } },
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  });
  if (!alishba) return error("Alishba not found");

  // Delete all her fines
  const deleted = await prisma.fine.deleteMany({
    where: { userId: alishba.id },
  });

  // Fix her absent records to PRESENT if she has any
  const fixedAtt = await prisma.attendance.updateMany({
    where: { userId: alishba.id, status: "ABSENT" },
    data: { status: "PRESENT" },
  });

  // Sync payroll
  try {
    const { syncPayrollRecord } = await import("@/lib/services/payroll-sync.service");
    const pkt = new Date(Date.now() + 5 * 60 * 60_000);
    await syncPayrollRecord(alishba.id, pkt.getUTCMonth() + 1, pkt.getUTCFullYear());
  } catch {}

  return json({
    message: `Alishba Qaiser (${alishba.employeeId}) — all fines cleared`,
    finesDeleted: deleted.count,
    absentsFixed: fixedAtt.count,
  });
}
