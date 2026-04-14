import { prisma } from "@/lib/prisma";
import { todayPKT, nowPKT } from "@/lib/pkt";

/**
 * Self-healing scan that detects and reverts the legacy bogus auto-checkout
 * pattern. Defense-in-depth against the recurring bug where pre-March-31
 * auto-checkout code (commit bb8eae7) writes:
 *   - checkOut = `today midnight UTC + 14h` (i.e. 2026-04-14T14:00:00.000Z)
 *   - workedMinutes = check-in to 14:00 UTC, typically 100-140 minutes
 *   - status = HALF_DAY (because worked < 240m threshold)
 *   - notes = "Auto-checkout by system at office closing time"
 *
 * That code path also creates fines using "(X/Y used)" format. Both
 * symptoms point to a Vercel deployment running stale code.
 *
 * This scan runs cheaply on page loads. If it finds today's records
 * matching ALL three signature criteria, it reverts them to the most
 * fair state: checkOut = 7:00 PM PKT, status recomputed from worked time.
 * Bogus fines from the same misfire are also re-normalized.
 *
 * Idempotent: running it on healthy data is a no-op.
 *
 * Returns the count of records that were healed (0 if nothing was bogus).
 */
export async function autoHealBogusCheckouts(): Promise<{ healed: number; fines: number }> {
  const today = todayPKT();
  const now = nowPKT();

  // Only act on TODAY's records — we don't retroactively touch history.
  // The bogus pattern: notes match, checkOut hour=14 (UTC display), workedMinutes < 240.
  const candidates = await prisma.attendance.findMany({
    where: {
      date: today,
      notes: "Auto-checkout by system at office closing time",
      checkOut: { not: null },
    },
    select: {
      id: true,
      userId: true,
      checkIn: true,
      checkOut: true,
      breakStart: true,
      breakEnd: true,
      workedMinutes: true,
      lateMinutes: true,
      status: true,
    },
  });

  if (candidates.length === 0) return { healed: 0, fines: 0 };

  // Office end in PKT-shifted form (DB stores PKT as if it were UTC)
  const officeEndShifted = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    19, 0, 0
  ));

  // Half-day threshold (matches officeSettings default)
  const halfDayThreshold = 240;

  let healed = 0;
  for (const a of candidates) {
    if (!a.checkIn || !a.checkOut) continue;

    // Match the EXACT bogus signature so we don't accidentally heal a
    // legitimate auto-checkout that happens to share the note text.
    const isBogus =
      a.checkOut.getUTCHours() === 14 &&
      a.checkOut.getUTCMinutes() === 0 &&
      a.checkOut.getUTCSeconds() === 0 &&
      (a.workedMinutes ?? 0) < halfDayThreshold;
    if (!isBogus) continue;

    // Don't extend checkOut past current PKT (e.g. if running early in the day)
    const targetCheckout = officeEndShifted.getTime() <= now.getTime() ? officeEndShifted : now;

    let breakMinutes = 0;
    if (a.breakStart && a.breakEnd) {
      breakMinutes = Math.floor((a.breakEnd.getTime() - a.breakStart.getTime()) / 60000);
    }
    const workedMinutes = Math.max(
      0,
      Math.floor((targetCheckout.getTime() - a.checkIn.getTime()) / 60000) - breakMinutes
    );

    let status: "PRESENT" | "LATE" | "HALF_DAY";
    if (workedMinutes < halfDayThreshold) {
      status = "HALF_DAY"; // genuine half-day
    } else if (a.lateMinutes && a.lateMinutes > 0) {
      status = "LATE";
    } else {
      status = "PRESENT";
    }

    await prisma.attendance.update({
      where: { id: a.id },
      data: {
        checkOut: targetCheckout,
        workedMinutes,
        earlyLeaveMin: null,
        overtimeMinutes: null,
        status,
        notes: "Auto-healed bogus auto-checkout (reverted to office close time)",
      },
    });
    healed++;
  }

  // Also re-normalize any "(X/Y used)" or "X days remaining)" formatted absent
  // fines from today — these are from the same legacy code path and have
  // wrong amounts.
  const legacyFines = await prisma.fine.findMany({
    where: {
      date: today,
      type: "ABSENT_WITHOUT_LEAVE",
      OR: [
        { reason: { contains: "/" } }, // matches "(X/Y used)"
        { reason: { contains: "days remaining" } }, // matches old format
      ],
    },
    select: { id: true, userId: true, amount: true, reason: true, date: true },
  });

  let fines = 0;
  if (legacyFines.length > 0) {
    const SYS_START = new Date(Date.UTC(2026, 3, 1));
    const settings = await prisma.officeSettings.findUnique({
      where: { id: "default" },
      select: { paidLeavesPerMonth: true },
    });
    const paidLeavesPerMonth = settings?.paidLeavesPerMonth ?? 1;
    const monthsActive = Math.max(
      1,
      (now.getUTCFullYear() - 2026) * 12 + (now.getUTCMonth() - 3) + 1
    );
    const totalEarned = monthsActive * paidLeavesPerMonth;
    const todayMs = today.getTime();

    for (const f of legacyFines) {
      const salary = await prisma.salaryStructure.findUnique({
        where: { userId: f.userId },
        select: { monthlySalary: true },
      });
      if (!salary) continue;
      const dailyRate = Math.round(salary.monthlySalary / 30);

      // Walk this user's chronological events to find correct coverage for today
      const [halfLeaves, absents] = await Promise.all([
        prisma.leaveRequest.findMany({
          where: {
            userId: f.userId,
            leaveType: "HALF_DAY",
            status: "APPROVED",
            startDate: { gte: SYS_START },
          },
          select: { startDate: true },
          orderBy: { startDate: "asc" },
        }),
        prisma.attendance.findMany({
          where: { userId: f.userId, status: "ABSENT", date: { gte: SYS_START } },
          select: { date: true },
          orderBy: { date: "asc" },
        }),
      ]);
      const events: Array<{ date: Date; kind: "half" | "absent" }> = [
        ...halfLeaves.map((l) => ({ date: l.startDate, kind: "half" as const })),
        ...absents.map((a) => ({ date: a.date, kind: "absent" as const })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      let budgetLeft = totalEarned;
      let coverageForToday: number | null = null;
      for (const ev of events) {
        if (ev.kind === "half") {
          budgetLeft = Math.max(0, budgetLeft - 0.5);
          continue;
        }
        const cov = Math.min(1, Math.max(0, budgetLeft));
        budgetLeft -= cov;
        if (ev.date.getTime() === todayMs) coverageForToday = cov;
      }

      if (coverageForToday === null) continue; // no matching absent for today

      const uncoveredFraction = 1 - coverageForToday;
      const expectedAmount = Math.round(dailyRate * uncoveredFraction);
      const dateStr = today.toISOString().slice(0, 10);
      let expectedReason: string;
      if (coverageForToday >= 1) {
        expectedReason = `Absent on ${dateStr} — Covered by paid leave (1.0 day used)`;
      } else if (coverageForToday > 0) {
        expectedReason = `Absent on ${dateStr} — Partially covered by paid leave (${coverageForToday.toFixed(1)} day used); PKR ${expectedAmount.toLocaleString()} (salary/30 × ${uncoveredFraction.toFixed(1)}) deducted`;
      } else {
        expectedReason = `Absent on ${dateStr} — PKR ${expectedAmount.toLocaleString()} (salary/30) deducted`;
      }

      if (f.amount !== expectedAmount || f.reason !== expectedReason) {
        await prisma.fine.update({
          where: { id: f.id },
          data: { amount: expectedAmount, reason: expectedReason },
        });
        fines++;
      }
    }
  }

  return { healed, fines };
}
