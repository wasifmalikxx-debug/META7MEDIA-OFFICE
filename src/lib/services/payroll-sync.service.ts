import { prisma } from "@/lib/prisma";
import { generatePayrollForEmployee } from "@/lib/services/payroll.service";

/**
 * Syncs the payroll record for a user/month/year after fines, incentives,
 * or bonus eligibility change.
 *
 * History: this used to maintain its own (simpler) recompute that
 * multiplied `payroll.halfDays * dailyRate * 0.5` and `payroll.absentDays
 * * dailyRate` directly. That bypassed the leave-coverage logic in
 * payroll.service.ts (orphanHalfDays = halfDays - matchedHalfDayLeaves;
 * absentDeductions = sum of absent fine amounts which are 0 when covered),
 * so a covered absent or a leave-covered half day silently got billed
 * back. Symptom: a user with one absent (covered) and one half-day (with
 * matching leave) was deducted ~1.5 × dailyRate every time a fine was
 * touched.
 *
 * Fix: delegate to generatePayrollForEmployee — the canonical generator
 * with all the coverage rules. Slightly heavier but eliminates the
 * duplicate-logic drift that caused the bug.
 */
export async function syncPayrollRecord(userId: string, month: number, year: number) {
  const payroll = await prisma.payrollRecord.findUnique({
    where: { userId_month_year: { userId, month, year } },
    select: { status: true, lockedAt: true },
  });

  if (!payroll) return; // No payroll record yet — will be created on Generate
  if (payroll.status === "PAID") return; // PAID is immutable
  if (payroll.lockedAt) return; // Locked snapshot is immutable

  // Pass the user's own ID as generatedBy — this is a system-triggered
  // recompute, not a manual generation. The original generator stamps
  // generatedBy on the record; using userId keeps it self-attributed
  // rather than misattributing to whichever admin happened to act last.
  await generatePayrollForEmployee(userId, month, year, userId);
}

/**
 * Fire-and-forget-safe wrapper around syncPayrollRecord.
 *
 * Use this from anywhere a fine / incentive is auto-created (attendance
 * check-in late fine, break-end late fine, daily-absent cron, no-show
 * cron, end-of-day no-report fine, break-skip fine) so that EVERY fine
 * that shows in Daily Activities immediately flows into the affected
 * month's payroll record. CEO directive 2026-06-09: "every daily
 * activity fine should add in payroll, no exceptions."
 *
 * Swallows errors — a payroll-sync failure must never break the
 * attendance/fine write that triggered it. PAID + locked records are
 * skipped inside syncPayrollRecord, so this can't mutate settled pay.
 */
export async function syncPayrollSafe(userId: string, month: number, year: number) {
  try {
    await syncPayrollRecord(userId, month, year);
  } catch (e) {
    console.warn(
      `[payroll-sync] failed for ${userId} ${month}/${year}:`,
      e instanceof Error ? e.message : e,
    );
  }
}
