import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/clear-march-fines
 * Deletes ALL fines from March 2026 for every employee, then regenerates payroll.
 */
export async function POST() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") return error("CEO only", 403);

  try {
    // Count before deleting
    const marchFines = await prisma.fine.findMany({
      where: { month: 3, year: 2026 },
      include: { user: { select: { employeeId: true, firstName: true } } },
    });

    const summary = new Map<string, { count: number; total: number }>();
    for (const f of marchFines) {
      const key = `${f.user.employeeId} ${f.user.firstName}`;
      const existing = summary.get(key) || { count: 0, total: 0 };
      existing.count++;
      existing.total += f.amount;
      summary.set(key, existing);
    }

    // Delete all March 2026 fines
    const deleted = await prisma.fine.deleteMany({
      where: { month: 3, year: 2026 },
    });

    // Regenerate payroll for all employees for March
    const { generatePayrollForAll } = await import("@/lib/services/payroll.service");
    const payrollResults = await generatePayrollForAll(3, 2026, session.user.id);

    return json({
      message: `Deleted ${deleted.count} fines from March 2026 and regenerated payroll`,
      finesDeleted: deleted.count,
      byEmployee: Array.from(summary.entries()).map(([name, { count, total }]) => ({
        employee: name,
        finesRemoved: count,
        amountCleared: `PKR ${total.toLocaleString()}`,
      })),
      payrollRegenerated: payrollResults.length,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
