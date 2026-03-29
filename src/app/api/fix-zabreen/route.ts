import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// One-time fix: correct Zabreen's March 27 absent fine to "Covered by paid leave"
// DELETE THIS FILE after running once
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const zabreen = await prisma.user.findFirst({
    where: { firstName: { contains: "Zabreen" } },
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  });

  if (!zabreen) return error("Zabreen not found");

  // Find her March 27 absent fine
  const fine = await prisma.fine.findFirst({
    where: {
      userId: zabreen.id,
      date: new Date("2026-03-27"),
      type: "ABSENT_WITHOUT_LEAVE",
    },
  });

  if (!fine) return error("No absent fine found for Zabreen on March 27");

  // Update fine to covered by paid leave (amount = 0)
  const updated = await prisma.fine.update({
    where: { id: fine.id },
    data: {
      amount: 0,
      reason: `Absent on 2026-03-27 — Covered by paid leave (1/1 used)`,
    },
  });

  // Sync payroll
  try {
    const { syncPayrollRecord } = await import("@/lib/services/payroll-sync.service");
    await syncPayrollRecord(zabreen.id, 3, 2026);
  } catch {}

  return json({
    message: `Fixed! Zabreen's March 27 fine updated to covered by paid leave.`,
    employee: zabreen.employeeId,
    oldAmount: fine.amount,
    newAmount: 0,
  });
}
