/**
 * ONE-OFF ADMIN ACTION (2026-05-25, requested by CEO):
 *
 *   1. DELETE Alishba EM-1's HALF_DAY leave request for May 25 — she
 *      already burned her monthly budget on the May 9 covered absence,
 *      so this half-day shouldn't have been auto-approved. The unified-
 *      pool fix (commit cba507b) blocks new ones, but this old record
 *      still sits in the DB. Removing it here forces her to complete
 *      a full day today.
 *
 *   2. FORCE her break-in for today — log a complete 60-minute break in
 *      the office's standard break window (15:00 – 16:00 PKT). She
 *      hasn't logged her break yet today, and with the half-day gone
 *      she now needs the break time recorded so end-of-day worked-
 *      minutes calc correctly subtracts the break.
 *
 * Both ops in a single transaction so partial state is impossible.
 *
 * Run:  npx tsx prisma/scripts/force-alishba-fix-may25.ts
 *
 * After this runs, Alishba's row on the attendance calendar will show:
 *   - status:     PRESENT (no longer HALF_DAY-tagged)
 *   - checkIn:    10:59 PKT (unchanged — what she actually punched)
 *   - breakStart: 15:00 PKT (forced — 3:00 PM standard break start)
 *   - breakEnd:   16:00 PKT (forced — 4:00 PM standard break end)
 *   - checkOut:   null      (she still has to check out at end of day)
 *   - Bal:        0 / 1     (budget now correctly shown exhausted)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// PKT wall-clock convention used throughout the codebase: a Date whose
// UTC components literally equal the PKT clock reading.
function pktDate(y: number, m1: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m1 - 1, d, h, min, 0, 0));
}

async function main() {
  const TODAY = pktDate(2026, 5, 25, 0, 0); // 2026-05-25 00:00 PKT
  const BREAK_START = pktDate(2026, 5, 25, 15, 0); // 15:00 PKT
  const BREAK_END = pktDate(2026, 5, 25, 16, 0); // 16:00 PKT

  const alishba = await prisma.user.findFirst({
    where: { employeeId: "EM-1" },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!alishba) throw new Error("EM-1 not found");

  console.log(`Subject: ${alishba.firstName} ${alishba.lastName} (${alishba.id})`);
  console.log("");

  // Snapshot BEFORE so we can diff after.
  const leavesBefore = await prisma.leaveRequest.findMany({
    where: { userId: alishba.id, startDate: { lte: TODAY }, endDate: { gte: TODAY } },
    select: { id: true, leaveType: true, reason: true, status: true },
  });
  const attBefore = await prisma.attendance.findFirst({
    where: { userId: alishba.id, date: TODAY },
    select: {
      id: true, status: true,
      checkIn: true, checkOut: true,
      breakStart: true, breakEnd: true, workedMinutes: true,
    },
  });

  console.log("BEFORE:");
  console.log("  Leaves today:", leavesBefore);
  console.log("  Attendance:  ", attBefore);
  console.log("");

  // Atomic transaction — both succeed or both rolled back.
  const result = await prisma.$transaction(async (tx) => {
    // 1) Delete the May 25 HALF_DAY leave (matches the only row from
    //    the inspect script; defensive scope by user + type + date so we
    //    never accidentally delete a wider leave).
    const deletedLeaves = await tx.leaveRequest.deleteMany({
      where: {
        userId: alishba.id,
        leaveType: "HALF_DAY",
        startDate: { gte: TODAY, lte: TODAY },
      },
    });

    // 2) Force the break window onto her existing attendance row.
    //    Keep status PRESENT (was PRESENT before; if it had been
    //    HALF_DAY because of an auto-checkout we'd flip it back too).
    if (!attBefore) {
      throw new Error("Alishba has no attendance row for today — refusing to fabricate one");
    }
    const updatedAtt = await tx.attendance.update({
      where: { id: attBefore.id },
      data: {
        status: "PRESENT",
        breakStart: BREAK_START,
        breakEnd: BREAK_END,
        // breakMinutes derived = 60. Some downstream code reads it from
        // the field, some computes from start/end. We set both to keep
        // the two surfaces in agreement.
        breakMinutes: 60,
      },
    });

    return { deletedLeaves, updatedAtt };
  });

  console.log("AFTER:");
  console.log(`  Deleted leaves: ${result.deletedLeaves.count}`);
  console.log(`  Updated attendance:`);
  console.log(`    status:       ${result.updatedAtt.status}`);
  console.log(`    checkIn:      ${result.updatedAtt.checkIn?.toISOString()}`);
  console.log(`    breakStart:   ${result.updatedAtt.breakStart?.toISOString()}`);
  console.log(`    breakEnd:     ${result.updatedAtt.breakEnd?.toISOString()}`);
  console.log(`    breakMinutes: ${(result.updatedAtt as any).breakMinutes ?? "(field n/a)"}`);
  console.log(`    checkOut:     ${result.updatedAtt.checkOut?.toISOString() || "(still open)"}`);
  console.log("");
  console.log("✓ Done. She'll check out herself at end of day; payroll will subtract the 60-min break.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
