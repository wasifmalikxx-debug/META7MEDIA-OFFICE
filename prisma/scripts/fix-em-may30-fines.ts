/**
 * CEO instruction (2026-06-09): add the May 30 fines into May payroll
 * for EM-team members whose salary is NOT yet paid — EXCEPT four who
 * were paid in advance + already have a manual June fine:
 *   EXCLUDE: EM-1 Alishba, EM-5 Attka, EM-9 Areefa, EM-10 Maira
 *
 * Mechanism: regenerate the May payroll record via the canonical
 * generator (generatePayrollForEmployee). That recomputes the whole
 * record from current data — picking up the May 30 ABSENT_WITHOUT_LEAVE
 * fine that already sits in the Fine table. generatePayrollForEmployee
 * internally skips PAID + locked records, so PAID people can't be
 * touched even if mis-targeted.
 *
 * SAFETY:
 *   - Only Etsy-EM department.
 *   - Only status != PAID and not locked.
 *   - Excludes the 4 named above.
 *   - Dry-run by default. Set EXECUTE=1 to write.
 *
 * Run:
 *   # preview
 *   DATABASE_URL=$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"') \
 *     npx tsx prisma/scripts/fix-em-may30-fines.ts
 *   # apply
 *   EXECUTE=1 DATABASE_URL=$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"') \
 *     npx tsx prisma/scripts/fix-em-may30-fines.ts
 */

import { PrismaClient } from "@prisma/client";
import { generatePayrollForEmployee } from "../../src/lib/services/payroll.service";

const prisma = new PrismaClient();

const EXCLUDE = new Set(["EM-1", "EM-5", "EM-9", "EM-10"]); // paid in advance + June manual fine
const EXECUTE = process.env.EXECUTE === "1";

async function main() {
  const may30 = new Date(Date.UTC(2026, 4, 30));
  const month = 5, year = 2026;

  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("No admin user");

  // EM team only
  const em = await prisma.user.findMany({
    where: {
      department: { name: "Etsy - EM" },
      status: { in: ["HIRED", "PROBATION"] },
    },
    select: { id: true, employeeId: true, firstName: true, lastName: true },
    orderBy: { employeeId: "asc" },
  });

  console.log(`MODE: ${EXECUTE ? "EXECUTE (writing)" : "DRY-RUN (no writes)"}`);
  console.log("EXCLUDED (paid in advance, June manual fine): EM-1, EM-5, EM-9, EM-10");
  console.log("═".repeat(110));

  const targets: { id: string; label: string; fine: number; before: any }[] = [];
  for (const e of em) {
    const empId = e.employeeId || "?";
    const name = `${e.firstName} ${e.lastName || ""}`.trim();

    const rec = await prisma.payrollRecord.findUnique({
      where: { userId_month_year: { userId: e.id, month, year } },
    });
    const may30Fine = await prisma.fine.aggregate({
      where: { userId: e.id, date: may30 },
      _sum: { amount: true },
    });
    const fineAmt = may30Fine._sum.amount || 0;

    let decision = "";
    if (EXCLUDE.has(empId)) decision = "SKIP — excluded (advance/June fine)";
    else if (!rec) decision = "SKIP — no May payroll record";
    else if (rec.status === "PAID") decision = "SKIP — already PAID (frozen)";
    else if (rec.lockedAt) decision = "SKIP — locked";
    else if (fineAmt <= 0) decision = "SKIP — no payable May-30 fine";
    else {
      decision = `TARGET — will deduct PKR ${fineAmt}`;
      targets.push({ id: e.id, label: `${empId} ${name}`, fine: fineAmt, before: rec });
    }

    console.log(
      `${empId.padEnd(7)} ${name.padEnd(20).slice(0,20)} | status=${(rec?.status||"none").padEnd(6)} | may30 fine PKR ${String(fineAmt).padStart(8)} | ${decision}`,
    );
  }

  console.log("");
  console.log(`Targets to re-sync: ${targets.length}`);
  if (targets.length === 0) { console.log("Nothing to do."); return; }

  if (!EXECUTE) {
    console.log("\nDRY-RUN — re-run with EXECUTE=1 to apply.");
    return;
  }

  console.log("\nApplying…");
  for (const t of targets) {
    const before = t.before;
    await generatePayrollForEmployee(t.id, month, year, admin.id);
    const after = await prisma.payrollRecord.findUnique({
      where: { userId_month_year: { userId: t.id, month, year } },
    });
    console.log(
      `  ✓ ${t.label}: netSalary ${before.netSalary} → ${after?.netSalary}  (totalDeductions ${before.totalDeductions} → ${after?.totalDeductions})`,
    );
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
