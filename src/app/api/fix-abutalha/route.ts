import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// One-time fix for Abu Talha Arshad (SMM-9):
// Delete all wrongful fines caused by half-day leave not being recognized
// DELETE THIS FILE after running
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const abuTalha = await prisma.user.findFirst({
    where: { employeeId: "SMM-9" },
    select: { id: true },
  });
  if (!abuTalha) return error("Abu Talha not found");

  // Delete all break-skip fines (duplicates)
  const breakFines = await prisma.fine.deleteMany({
    where: {
      userId: abuTalha.id,
      reason: "Break skipped — did not log break attendance",
    },
  });

  // Delete late arrival fine for the half-day leave date (he had first-half leave)
  const lateFine = await prisma.fine.deleteMany({
    where: {
      userId: abuTalha.id,
      type: "LATE_ARRIVAL",
      reason: { contains: "301 minutes late" },
    },
  });

  // Delete no-report fine
  const reportFine = await prisma.fine.deleteMany({
    where: {
      userId: abuTalha.id,
      reason: "Daily report not submitted before auto-checkout",
    },
  });

  // Sync payroll
  try {
    const { syncPayrollRecord } = await import("@/lib/services/payroll-sync.service");
    const pkt = new Date(Date.now() + 5 * 60 * 60_000);
    await syncPayrollRecord(abuTalha.id, pkt.getUTCMonth() + 1, pkt.getUTCFullYear());
  } catch {}

  // Fix attendance status: set HALF_DAY for days with approved half-day leave
  const leaves = await prisma.leaveRequest.findMany({
    where: { userId: abuTalha.id, leaveType: "HALF_DAY", status: "APPROVED" },
    select: { startDate: true },
  });
  let statusFixed = 0;
  for (const lv of leaves) {
    const att = await prisma.attendance.findUnique({
      where: { userId_date: { userId: abuTalha.id, date: lv.startDate } },
    });
    if (att && att.status !== "HALF_DAY") {
      await prisma.attendance.update({
        where: { id: att.id },
        data: { status: "HALF_DAY" },
      });
      statusFixed++;
    }
  }

  return json({
    message: "Abu Talha's fines fixed",
    breakFinesDeleted: breakFines.count,
    lateFinesDeleted: lateFine.count,
    reportFinesDeleted: reportFine.count,
    statusFixed,
  });
}
