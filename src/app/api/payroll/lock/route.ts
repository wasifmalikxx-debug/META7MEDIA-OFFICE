import { NextRequest } from "next/server";
import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// POST /api/payroll/lock
// Body: { month, year }
// Creates an immutable PayrollSnapshot for the given month/year containing the
// current payroll records plus totals, then marks every record for that month
// as locked (lockedAt = now). Once locked:
//   - auto-regen on page view is skipped
//   - generatePayrollForEmployee() returns the existing record unchanged
//   - status transitions (DRAFT -> PAID etc.) still allowed via explicit PATCH,
//     but recalculation is frozen
// Idempotent: if a snapshot already exists for this month, returns it and
// re-locks any records that slipped through (defensive).
export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const month = parseInt(body.month);
    const year = parseInt(body.year);
    if (!month || !year || month < 1 || month > 12 || year < 2000) {
      return error("Invalid month/year");
    }

    // Collect the records that will be in the snapshot
    const records = await prisma.payrollRecord.findMany({
      where: { month, year },
      include: {
        user: {
          select: {
            employeeId: true,
            firstName: true,
            lastName: true,
            designation: true,
            department: { select: { name: true } },
            bankName: true,
            accountNumber: true,
            accountTitle: true,
          },
        },
      },
      orderBy: { user: { employeeId: "asc" } },
    });

    if (records.length === 0) {
      return error("No payroll records to lock for this month. Generate payroll first.");
    }

    const totalGross = records.reduce((s, r) => s + (r.earnedSalary || 0), 0);
    const totalIncentives = records.reduce((s, r) => s + (r.totalIncentives || 0), 0);
    const totalFines = records.reduce((s, r) => s + (r.totalFines || 0), 0);
    const totalNet = records.reduce((s, r) => s + (r.netSalary || 0), 0);

    const now = new Date();

    // Snapshot (idempotent upsert) + lock records in a single transaction
    const [snapshot] = await prisma.$transaction([
      prisma.payrollSnapshot.upsert({
        where: { month_year: { month, year } },
        create: {
          month,
          year,
          lockedById: session.user.id,
          lockedAt: now,
          recordCount: records.length,
          totalGross,
          totalIncentives,
          totalFines,
          totalNet,
          data: records as any,
        },
        update: {
          // If re-locking, refresh snapshot contents with current state
          lockedById: session.user.id,
          lockedAt: now,
          recordCount: records.length,
          totalGross,
          totalIncentives,
          totalFines,
          totalNet,
          data: records as any,
        },
      }),
      prisma.payrollRecord.updateMany({
        where: { month, year, lockedAt: null },
        data: { lockedAt: now },
      }),
    ]);

    return json({
      success: true,
      snapshotId: snapshot.id,
      recordCount: records.length,
      totalNet,
      lockedAt: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[payroll/lock]", err);
    return error(err.message || "Failed to lock payroll", 500);
  }
}

// DELETE /api/payroll/lock?month=4&year=2026
// Unlocks the month: deletes the snapshot and clears lockedAt on all records.
// The records themselves are preserved; only the lock is released so that
// auto-regen can resume.
export async function DELETE(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const { searchParams } = new URL(request.url);
    const month = parseInt(searchParams.get("month") || "0");
    const year = parseInt(searchParams.get("year") || "0");
    if (!month || !year) return error("Invalid month/year");

    await prisma.$transaction([
      prisma.payrollSnapshot.deleteMany({
        where: { month, year },
      }),
      prisma.payrollRecord.updateMany({
        where: { month, year },
        data: { lockedAt: null },
      }),
    ]);

    return json({ success: true });
  } catch (err: any) {
    console.error("[payroll/lock DELETE]", err);
    return error(err.message || "Failed to unlock payroll", 500);
  }
}
