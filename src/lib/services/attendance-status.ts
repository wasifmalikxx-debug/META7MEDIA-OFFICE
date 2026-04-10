/**
 * SINGLE SOURCE OF TRUTH for attendance status resolution.
 *
 * This is the ONLY function that decides what status an attendance record
 * should have at checkout time (manual, auto, or leave-triggered).
 *
 * Rules (in priority order):
 * 1. If employee has an APPROVED HALF_DAY leave for this date → HALF_DAY
 * 2. If workedMinutes >= halfDayThresholdMin AND no late → PRESENT
 * 3. If workedMinutes >= halfDayThresholdMin AND was late → LATE
 * 4. If workedMinutes < halfDayThresholdMin AND no leave → still PRESENT or LATE
 *    (we never silently mark HALF_DAY without a leave request — that's what
 *    was causing the bug: power outage / break glitch left people with tiny
 *    worked minutes but no leave, and the system guessed wrong)
 *
 * A stale HALF_DAY status from a previous buggy state is ACTIVELY CORRECTED.
 */

import { prisma } from "@/lib/prisma";
import { AttendanceStatus } from "@prisma/client";

export interface StatusResolutionInput {
  userId: string;
  date: Date;
  workedMinutes: number;
  lateMinutes?: number | null;
  currentStatus: AttendanceStatus;
}

export interface StatusResolutionResult {
  status: AttendanceStatus;
  hasHalfDayLeave: boolean;
  halfDayPeriod: string | null;
  reason: string;
}

export async function resolveAttendanceStatus(
  input: StatusResolutionInput
): Promise<StatusResolutionResult> {
  const { userId, date, lateMinutes, currentStatus } = input;

  // 1. Check for an APPROVED half-day leave for this exact date
  const halfDayLeave = await prisma.leaveRequest.findFirst({
    where: {
      userId,
      startDate: date,
      leaveType: "HALF_DAY",
      status: "APPROVED",
    },
    select: { halfDayPeriod: true },
  });

  if (halfDayLeave) {
    return {
      status: AttendanceStatus.HALF_DAY,
      hasHalfDayLeave: true,
      halfDayPeriod: halfDayLeave.halfDayPeriod,
      reason: "Approved half-day leave exists",
    };
  }

  // 2. No leave — they either worked full or partial, but never HALF_DAY without a leave
  // If the current status was HALF_DAY from a stale/glitched state, correct it
  const baseStatus: AttendanceStatus =
    lateMinutes && lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

  if (currentStatus === AttendanceStatus.HALF_DAY) {
    return {
      status: baseStatus,
      hasHalfDayLeave: false,
      halfDayPeriod: null,
      reason: "Corrected stale HALF_DAY — no leave request exists",
    };
  }

  // 3. Preserve non-HALF_DAY status (PRESENT, LATE, ABSENT, etc.)
  return {
    status: currentStatus === AttendanceStatus.ABSENT ? baseStatus : currentStatus,
    hasHalfDayLeave: false,
    halfDayPeriod: null,
    reason: "No half-day leave, preserved/normalized status",
  };
}
