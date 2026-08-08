/**
 * ONE-OFF (2026-06-25): today became an official holiday ("Ashura Day 1") but the
 * daily-absent cron had already run and generated absent fines + ABSENT marks.
 * Reset ONLY today's data:
 *   1. backup + delete today's AUTO absent fines (reason "Absent on 2026-06-25 …")
 *   2. set today's ABSENT attendance -> HOLIDAY (leave ON_LEAVE / others untouched)
 *   3. re-sync June payroll for affected employees so totals drop today's deduction
 *      and the monthly absent-cover re-allocates correctly
 * Strictly scoped to date = 2026-06-25. Preserves any non-auto (manual) fine.
 */
import { writeFileSync } from "fs";
import { prisma } from "../../src/lib/prisma";
import { generatePayrollForEmployee } from "../../src/lib/services/payroll.service";

const TODAY = new Date("2026-06-25T00:00:00.000Z");
const DAYEND = new Date("2026-06-26T00:00:00.000Z");
const AUTO_PREFIX = "Absent on 2026-06-25";
const MONTH = 6;
const YEAR = 2026;

async function main() {
  const host = (process.env.DATABASE_URL || "").replace(/:\/\/[^@]*@/, "://***@").replace(/\?.*/, "");
  console.log("DB target:", host);
  if (!/supabase\.com/.test(host)) {
    console.error("ABORT: DATABASE_URL is not the prod Supabase host.");
    process.exit(1);
  }

  // ── 1. Today's fines: split auto-absent vs anything else (preserve manual) ──
  const allTodayFines = await prisma.fine.findMany({ where: { date: { gte: TODAY, lt: DAYEND } } });
  const autoAbsent = allTodayFines.filter((f) => f.reason.startsWith(AUTO_PREFIX));
  const other = allTodayFines.filter((f) => !f.reason.startsWith(AUTO_PREFIX));
  console.log(`\nToday's fines: ${allTodayFines.length} total → ${autoAbsent.length} auto-absent, ${other.length} other`);
  if (other.length) {
    console.log("  ⚠ PRESERVING these non-auto fines (NOT deleted):");
    for (const f of other) console.log(`    id=${f.id} type=${f.type} amount=${f.amount} reason="${f.reason}"`);
  }
  // safety guard against runaway scope
  if (autoAbsent.length > 40) { console.error(`ABORT: ${autoAbsent.length} auto-absent fines is more than expected.`); process.exit(1); }

  // backup before delete
  const backupPath = "/tmp/today-fines-backup-2026-06-25.json";
  writeFileSync(backupPath, JSON.stringify(autoAbsent, null, 2));
  console.log(`Backed up ${autoAbsent.length} fines (sum=${autoAbsent.reduce((s, f) => s + f.amount, 0).toFixed(2)}) → ${backupPath}`);

  const affected = new Set<string>(autoAbsent.map((f) => f.userId));

  // ── 2. Delete the auto-absent fines (by exact IDs) ──
  const del = await prisma.fine.deleteMany({ where: { id: { in: autoAbsent.map((f) => f.id) } } });
  console.log(`Deleted ${del.count} auto-absent fines.`);

  // ── 3. Today's ABSENT attendance → HOLIDAY (ON_LEAVE / others untouched) ──
  const absRows = await prisma.attendance.findMany({
    where: { date: { gte: TODAY, lt: DAYEND }, status: "ABSENT" },
    select: { userId: true },
  });
  absRows.forEach((a) => affected.add(a.userId));
  const upd = await prisma.attendance.updateMany({
    where: { date: { gte: TODAY, lt: DAYEND }, status: "ABSENT" },
    data: { status: "HOLIDAY" },
  });
  console.log(`Set ${upd.count} ABSENT attendance rows → HOLIDAY.`);

  // ── 4. Re-sync June payroll for affected employees ──
  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  const affectedIds = [...affected];
  console.log(`\nRe-syncing June payroll for ${affectedIds.length} affected employees…`);
  let ok = 0;
  for (const uid of affectedIds) {
    try { await generatePayrollForEmployee(uid, MONTH, YEAR, admin!.id); ok++; }
    catch (e: any) { console.warn(`  resync failed for ${uid}: ${e.message}`); }
  }
  console.log(`Re-synced ${ok}/${affectedIds.length}.`);

  // ── 5. Verify ──
  const finesLeft = await prisma.fine.count({ where: { date: { gte: TODAY, lt: DAYEND }, reason: { startsWith: AUTO_PREFIX } } });
  const absLeft = await prisma.attendance.count({ where: { date: { gte: TODAY, lt: DAYEND }, status: "ABSENT" } });
  const byStatus = await prisma.attendance.groupBy({ by: ["status"], where: { date: { gte: TODAY, lt: DAYEND } }, _count: { _all: true } });
  console.log(`\nVERIFY → auto-absent fines remaining: ${finesLeft} (expect 0) | ABSENT attendance remaining: ${absLeft} (expect 0)`);
  console.log("Today's attendance by status now:", byStatus.map((t) => `${t.status}:${t._count._all}`).join(", "));
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
