import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Move SMM-7 (Sami), SMM-8 (Maroof), SMM-9 (Abu Talha) from OFFICE 2's
 * Facebook team back to OFFICE 1's Facebook department.
 *
 * Background: phase6 indiscriminately moves all SMM-* employees to OFFICE 2.
 * But these three work from OFFICE 1 and report to the CEO directly (no team
 * lead, no team membership). This script restores that structure.
 *
 * Idempotent — re-running with employees already on OFFICE 1 produces no
 * changes.
 */

const TARGETS = ["SMM-7", "SMM-8", "SMM-9"];

async function main() {
  console.log("Restoring OFFICE 1 Facebook employees (SMM-7/8/9)\n");

  const office1 = await prisma.office.findUnique({ where: { slug: "office-1" } });
  if (!office1) throw new Error("OFFICE 1 not found");

  // Find OFFICE 1's Facebook department. It still exists post-phase6 because
  // phase6 only creates OFFICE 2's Facebook — the OFFICE 1 one is left intact
  // (just emptied of employees). Renamed to "Facebook - HQ" on May 5 to
  // disambiguate from OFFICE 2's "Facebook - O2" in the dropdowns.
  const office1Fb = await prisma.department.findFirst({
    where: { name: "Facebook - HQ", officeId: office1.id },
  });
  if (!office1Fb) throw new Error("OFFICE 1 'Facebook - HQ' department not found");

  console.log(`  OFFICE 1 Facebook dept: ${office1Fb.id}\n`);

  for (const empId of TARGETS) {
    const u = await prisma.user.findUnique({ where: { employeeId: empId } });
    if (!u) {
      console.log(`  · ${empId}  (not in DB — skipped)`);
      continue;
    }
    if (u.officeId === office1.id && u.departmentId === office1Fb.id) {
      console.log(`  · ${empId}  ${u.firstName} — already on OFFICE 1 Facebook`);
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: {
        officeId: office1.id,
        departmentId: office1Fb.id,
        // OFFICE 1 FB employees report to CEO directly — no team, no manager.
        teamId: null,
        managerId: null,
      },
    });
    console.log(`  ↻ ${empId}  ${u.firstName} → OFFICE 1 Facebook`);
  }

  console.log(`\n  ✅ Done`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
