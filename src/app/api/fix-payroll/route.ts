import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { pktMonth, pktYear } from "@/lib/pkt";

// Regenerate payroll for all employees this month to fix incorrect calculations
// DELETE THIS FILE after running
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const month = pktMonth();
  const year = pktYear();

  try {
    const { generatePayrollForAll } = await import("@/lib/services/payroll.service");
    const results = await generatePayrollForAll(month, year, session.user.id);
    return json({
      message: `Payroll regenerated for ${results.length} employees for ${month}/${year}`,
      count: results.length,
    });
  } catch (err: any) {
    return error(err.message);
  }
}
