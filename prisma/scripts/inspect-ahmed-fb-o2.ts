/**
 * Investigation: Ahmed from Zain's FB-O2 team
 * - Took a half-day leave (which half?) for yesterday
 * - Did NOT show up for the OTHER half
 * - No fine was implemented
 *
 * Print:
 *   1. Ahmed's user row (resolve which Ahmed — there are several)
 *   2. His leave requests for yesterday + today
 *   3. His attendance row for yesterday + today
 *   4. Any fines for yesterday
 *   5. Office break window + work-end time for context
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const today = new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()));
  const yesterday = new Date(today.getTime() - 86_400_000);

  console.log(`Today (PKT): ${today.toISOString().split("T")[0]}`);
  console.log(`Yesterday  : ${yesterday.toISOString().split("T")[0]}`);
  console.log("═".repeat(110));

  // CEO said "Ahmed from Zain FB team" — resolved to M. Ahmad Aslam (SMM-2).
  // Pakistani spelling Ahmed/Ahmad is interchangeable; the user only one in
  // Zain's FB-O2 team with that name root.
  const ahmeds = await prisma.user.findMany({
    where: {
      employeeId: "SMM-2",
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      status: true,
      department: { select: { name: true } },
      team: { select: { name: true, partner: { select: { firstName: true } } } },
      office: { select: { name: true } },
    },
  });

  if (ahmeds.length === 0) {
    console.log("\nNo Ahmed found in FB-O2 / Zain's team. Widening to all 'Ahmed' in Facebook depts...");
    const allAhmed = await prisma.user.findMany({
      where: {
        firstName: { contains: "Ahmed", mode: "insensitive" },
        department: { name: { contains: "Facebook", mode: "insensitive" } },
      },
      select: {
        id: true, employeeId: true, firstName: true, lastName: true,
        status: true,
        department: { select: { name: true } },
        team: { select: { name: true, partner: { select: { firstName: true } } } },
        office: { select: { name: true } },
      },
    });
    ahmeds.push(...allAhmed);
  }

  if (ahmeds.length === 0) {
    console.log("\nStill no match. Listing all Facebook team employees with 'Ahm' in name...");
    const broad = await prisma.user.findMany({
      where: {
        OR: [
          { firstName: { contains: "Ahm", mode: "insensitive" } },
          { lastName: { contains: "Ahm", mode: "insensitive" } },
        ],
        department: { name: { contains: "Facebook", mode: "insensitive" } },
      },
      select: {
        id: true, employeeId: true, firstName: true, lastName: true, status: true,
        department: { select: { name: true } },
        team: { select: { name: true, partner: { select: { firstName: true } } } },
      },
    });
    console.log(`Found ${broad.length}:`);
    for (const u of broad) {
      console.log(`  ${u.employeeId} ${u.firstName} ${u.lastName || ""} | ${u.department?.name} | team=${u.team?.name ?? "—"}`);
    }
    return;
  }

  for (const ahmed of ahmeds) {
    console.log(`\n────────────────────────────────────────────────────────────────────────`);
    console.log(`SUBJECT: ${ahmed.firstName} ${ahmed.lastName || ""} (${ahmed.employeeId})`);
    console.log(`  Status   : ${ahmed.status}`);
    console.log(`  Dept     : ${ahmed.department?.name}`);
    console.log(`  Team     : ${ahmed.team?.name ?? "—"} (partner: ${ahmed.team?.partner?.firstName ?? "—"})`);
    console.log(`  Office   : ${ahmed.office?.name ?? "—"}`);
    console.log(`  User id  : ${ahmed.id}`);

    // Leave requests covering yesterday or today
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        userId: ahmed.id,
        OR: [
          { startDate: { lte: today }, endDate: { gte: yesterday } },
        ],
      },
      select: {
        id: true, leaveType: true, halfDayPeriod: true,
        startDate: true, endDate: true, totalDays: true,
        reason: true, status: true, createdAt: true,
      },
      orderBy: { startDate: "desc" },
    });
    console.log(`\n  LEAVE REQUESTS covering ${yesterday.toISOString().split("T")[0]} or ${today.toISOString().split("T")[0]}:`);
    if (leaves.length === 0) console.log(`    (none)`);
    for (const l of leaves) {
      console.log(`    ${l.startDate.toISOString().split("T")[0]} → ${l.endDate.toISOString().split("T")[0]} | ${l.leaveType}${l.halfDayPeriod ? " " + l.halfDayPeriod : ""} | ${l.totalDays}d | ${l.status} | "${l.reason}" | filed ${l.createdAt.toISOString()}`);
    }

    // Attendance yesterday + today
    for (const d of [yesterday, today]) {
      const att = await prisma.attendance.findFirst({
        where: { userId: ahmed.id, date: d },
      });
      console.log(`\n  ATTENDANCE ${d.toISOString().split("T")[0]}:`);
      if (!att) {
        console.log(`    (no row — usually means absent or daily-absent cron hasn't run)`);
      } else {
        console.log(`    status:        ${att.status}`);
        console.log(`    checkIn:       ${att.checkIn?.toISOString() || "—"}`);
        console.log(`    checkOut:      ${att.checkOut?.toISOString() || "—"}`);
        console.log(`    breakStart:    ${att.breakStart?.toISOString() || "—"}`);
        console.log(`    breakEnd:      ${att.breakEnd?.toISOString() || "—"}`);
        console.log(`    workedMin:     ${att.workedMinutes ?? "—"}`);
        console.log(`    informedAbs?:  ${att.informedAbsent}`);
      }
    }

    // Fines yesterday
    const fines = await prisma.fine.findMany({
      where: {
        userId: ahmed.id,
        date: yesterday,
      },
      select: { id: true, type: true, amount: true, reason: true, createdAt: true },
    });
    console.log(`\n  FINES dated ${yesterday.toISOString().split("T")[0]}:`);
    if (fines.length === 0) console.log(`    (none)`);
    for (const f of fines) {
      console.log(`    ${f.type} | PKR ${f.amount} | "${f.reason}" | created ${f.createdAt.toISOString()}`);
    }
  }

  // Office settings for context — break window + work end time
  const office = await prisma.officeSettings.findFirst({
    where: { office: { isPrimary: true } },
    select: {
      workStartTime: true,
      workEndTime: true,
      breakStartTime: true,
      breakEndTime: true,
      halfDayThresholdMin: true,
      paidLeavesPerMonth: true,
    },
  });
  console.log(`\n────────────────────────────────────────────────────────────────────────`);
  console.log(`OFFICE SETTINGS (for context):`);
  console.log(`  workStartTime:       ${office?.workStartTime}`);
  console.log(`  workEndTime:         ${office?.workEndTime}`);
  console.log(`  breakStartTime:      ${office?.breakStartTime}`);
  console.log(`  breakEndTime:        ${office?.breakEndTime}`);
  console.log(`  halfDayThresholdMin: ${office?.halfDayThresholdMin}`);
  console.log(`  paidLeavesPerMonth:  ${office?.paidLeavesPerMonth}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
