import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const may30 = new Date(Date.UTC(2026, 4, 30));
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][may30.getUTCDay()];
  console.log(`May 30 2026 is a ${dow}`);
  console.log("=".repeat(118));

  // All fines dated exactly May 30
  const may30Fines = await p.fine.findMany({
    where: { date: may30 },
    include: { user: { select: { id: true, employeeId: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\nFines dated 2026-05-30: ${may30Fines.length}`);
  for (const f of may30Fines) {
    console.log(`  ${f.user.employeeId} ${f.user.firstName} | ${f.type} | PKR ${f.amount} | created ${f.createdAt.toISOString()} | "${(f.reason||'').slice(0,55)}"`);
  }
  console.log("");
  console.log("=".repeat(118));
  console.log("PER-EMPLOYEE: is the May-30 fine reflected in their May payroll record?");
  console.log("-".repeat(118));

  const userIds = [...new Set(may30Fines.map(f => f.user.id))];
  for (const uid of userIds) {
    const u = may30Fines.find(f => f.user.id === uid)!.user;
    // full month fines split
    const monthFines = await p.fine.findMany({ where: { userId: uid, month: 5, year: 2026 }, select: { type: true, amount: true, createdAt: true } });
    const liveNonAbsent = monthFines.filter(f => f.type !== "ABSENT_WITHOUT_LEAVE").reduce((s,f)=>s+f.amount,0);
    const liveAbsent = monthFines.filter(f => f.type === "ABSENT_WITHOUT_LEAVE").reduce((s,f)=>s+f.amount,0);

    // the may30 fine(s) for this user + the latest createdAt among them
    const my30 = may30Fines.filter(f => f.user.id === uid);
    const latestFineCreated = my30.reduce((m,f)=> f.createdAt > m ? f.createdAt : m, my30[0].createdAt);

    const rec = await p.payrollRecord.findUnique({ where: { userId_month_year: { userId: uid, month: 5, year: 2026 } } });

    console.log(`\n${u.employeeId} ${u.firstName} ${u.lastName||""}`);
    if (!rec) { console.log("  ✗ NO payroll record for May — will appear only after Generate Payroll"); continue; }

    console.log(`  Payroll status:   ${rec.status}${rec.lockedAt ? " (LOCKED)" : ""}`);
    console.log(`  May 30 fine(s):   ${my30.map(f=>`${f.type} PKR ${f.amount}`).join(", ")}`);
    console.log(`  Stored totalFines (non-absent): PKR ${rec.totalFines}   | live non-absent: PKR ${liveNonAbsent}  ${Math.abs(rec.totalFines-liveNonAbsent)<0.5?"✓":"✗ STALE"}`);
    console.log(`  Stored totalDeductions:         PKR ${rec.totalDeductions}  (incl. absent deductions; live absent fines = PKR ${liveAbsent})`);
    console.log(`  Record updatedAt: ${rec.updatedAt.toISOString()}`);
    console.log(`  Latest fine made: ${latestFineCreated.toISOString()}`);

    const syncedAfterFine = rec.updatedAt.getTime() >= latestFineCreated.getTime();
    const has30Absent = my30.some(f => f.type === "ABSENT_WITHOUT_LEAVE");
    const has30NonAbsent = my30.some(f => f.type !== "ABSENT_WITHOUT_LEAVE");

    let verdict = "";
    if (rec.status === "PAID" || rec.lockedAt) {
      verdict = `⚠ FROZEN (${rec.status}${rec.lockedAt?"+LOCKED":""}) — fine created but payroll NOT recomputed`;
      if (!syncedAfterFine) verdict += " → NOT reflected";
      else verdict += " → was synced before freeze, reflected";
    } else {
      // DRAFT — should auto-sync. Verify.
      const nonAbsentOk = Math.abs(rec.totalFines - liveNonAbsent) < 0.5;
      if (syncedAfterFine && (!has30NonAbsent || nonAbsentOk)) {
        verdict = "✓ REFLECTING (record recomputed after the fine)";
      } else if (!syncedAfterFine) {
        verdict = "✗ NOT REFLECTING — record older than the fine; needs a re-sync";
      } else if (has30NonAbsent && !nonAbsentOk) {
        verdict = "✗ NOT REFLECTING — totalFines doesn't match live";
      } else {
        verdict = "✓ REFLECTING";
      }
    }
    console.log(`  VERDICT: ${verdict}`);
  }
}
main().catch(console.error).finally(()=>p.$disconnect());
