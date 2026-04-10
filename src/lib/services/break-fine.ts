/**
 * SINGLE SOURCE OF TRUTH for break-skip fine logic.
 *
 * A break-skip fine should be created ONLY when:
 * 1. Employee did not log a break (breakStart is null)
 * 2. Employee has NO approved half-day leave (first-half or second-half)
 * 3. Employee actually worked long enough to cover the break window
 *    (otherwise they couldn't have skipped it — they weren't there)
 * 4. No duplicate fine already exists for the same day
 *
 * Also handles the "power outage" edge case: if worked minutes < break window,
 * the employee physically couldn't have taken a break, so no fine.
 */

import { prisma } from "@/lib/prisma";
import { pktMonth, pktYear } from "@/lib/pkt";

export const BREAK_SKIP_FINE_REASON = "Break skipped — did not log break attendance";

export interface BreakFineInput {
  userId: string;
  date: Date;
  breakStart: Date | null;
  checkIn: Date | null;
  checkOut: Date | null;
  workedMinutes: number;
  adminId: string;
}

/**
 * Determines if a break-skip fine should be created, and creates it if so.
 * Returns true if fine was created, false otherwise.
 */
export async function maybeCreateBreakSkipFine(
  input: BreakFineInput
): Promise<{ created: boolean; reason: string }> {
  const { userId, date, breakStart, workedMinutes, adminId } = input;

  // 1. Break was logged — no fine
  if (breakStart) {
    return { created: false, reason: "Break was logged" };
  }

  // 2. Check for half-day leave (any period) — exempt from break fine
  const halfDayLeave = await prisma.leaveRequest.findFirst({
    where: {
      userId,
      startDate: date,
      leaveType: "HALF_DAY",
      status: "APPROVED",
    },
    select: { id: true, halfDayPeriod: true },
  });
  if (halfDayLeave) {
    return { created: false, reason: `Half-day leave exists (${halfDayLeave.halfDayPeriod})` };
  }

  // 3. Get settings for fine amount and break window
  const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
  if (!settings || settings.breakLateFineAmt <= 0) {
    return { created: false, reason: "Break fine disabled" };
  }

  // 4. If employee worked less than the break window duration, they couldn't
  // have skipped the break — they weren't present long enough
  // Break window is normally 60 minutes, Friday 75 minutes
  // Only fine if they worked through the break window
  const minWorkedForFine = 240; // 4 hours — if they worked at least 4h, they were there during break
  if (workedMinutes < minWorkedForFine) {
    return { created: false, reason: `Only worked ${workedMinutes}m — too short to fine for skipped break` };
  }

  // 5. Check for duplicate fine
  const existingFine = await prisma.fine.findFirst({
    where: { userId, date, reason: BREAK_SKIP_FINE_REASON },
  });
  if (existingFine) {
    return { created: false, reason: "Fine already exists" };
  }

  // 6. Create the fine
  await prisma.fine.create({
    data: {
      userId,
      type: "POLICY_VIOLATION",
      amount: settings.breakLateFineAmt,
      reason: BREAK_SKIP_FINE_REASON,
      date,
      month: pktMonth(),
      year: pktYear(),
      issuedById: adminId,
    },
  });

  return { created: true, reason: "Fine created" };
}
