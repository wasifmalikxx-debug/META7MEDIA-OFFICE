import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { pktMonth, pktYear } from "@/lib/pkt";

// Fix: Delete covered absence fines that were created by old buggy cron
// Then regenerate payroll for affected employees
// DELETE THIS FILE after running
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const month = pktMonth();
  const year = pktYear();

  // Delete ALL covered absence fines for this month (amount=0, "Covered by paid leave")
  // These will be recreated correctly when payroll regenerates
  const deleted = await prisma.fine.deleteMany({
    where: {
      month,
      year,
      amount: 0,
      reason: { contains: "Covered by paid leave" },
    },
  });

  // Now regenerate payroll — it will correctly calculate paid leave coverage
  const { generatePayrollForAll } = await import("@/lib/services/payroll.service");
  const results = await generatePayrollForAll(month, year, session.user.id);

  return json({
    message: `Deleted ${deleted.count} old covered fines, regenerated payroll for ${results.length} employees`,
    coveredFinesDeleted: deleted.count,
    payrollCount: results.length,
  });
}
