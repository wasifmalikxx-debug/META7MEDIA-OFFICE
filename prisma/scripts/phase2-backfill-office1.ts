import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Phase 2 backfill — assign all existing data to OFFICE 1.
 *
 * Idempotent: re-running produces no extra changes. Safe to run multiple
 * times against the same DB.
 *
 * Steps:
 *   1. Locate the CEO (SUPER_ADMIN) — becomes Office 1's owner.
 *   2. Create the OFFICE 1 row if it doesn't exist (slug "office-1").
 *   3. Backfill officeId on every User/Department/OfficeSettings/PayrollSnapshot.
 *   4. Wire Team.leadBonusPerEligible = 5000 on OFFICE 1's Etsy team
 *      (preserves Izaan's existing PKR 5,000 / eligible-employee formula).
 *      Other teams stay NULL (no team-lead bonus).
 *   5. Print a verification summary.
 */
async function main() {
  console.log("Phase 2 backfill — assigning existing data to OFFICE 1\n");

  // 1. Find CEO
  const ceo = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true, email: true, firstName: true },
  });
  if (!ceo) throw new Error("No SUPER_ADMIN user found — cannot proceed");
  console.log(`  CEO:      ${ceo.email} (${ceo.firstName})`);

  // 2. Upsert OFFICE 1
  const office1 = await prisma.office.upsert({
    where: { slug: "office-1" },
    update: {},
    create: {
      slug: "office-1",
      name: "META7MEDIA HQ",
      isPrimary: true,
      ownerId: ceo.id,
    },
  });
  console.log(`  Office:   ${office1.slug} (${office1.id})\n`);

  // 3. Backfill officeId everywhere it's NULL.
  //
  // We use raw SQL here because after Phase 3, the Prisma type for officeId
  // is `string` (NOT NULL) — so `where: { officeId: null }` is a TypeScript
  // error even though Postgres still accepts it during a partial migration.
  // For the production rollout this script must run BEFORE the constraint
  // flip, when NULLs still exist physically.
  const userUpd: number = (await prisma.$executeRaw`UPDATE "User" SET "officeId" = ${office1.id} WHERE "officeId" IS NULL`) as unknown as number;
  console.log(`  Users updated:           ${userUpd}`);

  const deptUpd: number = (await prisma.$executeRaw`UPDATE "Department" SET "officeId" = ${office1.id} WHERE "officeId" IS NULL`) as unknown as number;
  console.log(`  Departments updated:     ${deptUpd}`);

  const settingsUpd: number = (await prisma.$executeRaw`UPDATE "OfficeSettings" SET "officeId" = ${office1.id} WHERE "officeId" IS NULL`) as unknown as number;
  console.log(`  OfficeSettings updated:  ${settingsUpd}`);

  const snapshotUpd: number = (await prisma.$executeRaw`UPDATE "PayrollSnapshot" SET "officeId" = ${office1.id} WHERE "officeId" IS NULL`) as unknown as number;
  console.log(`  PayrollSnapshots updated: ${snapshotUpd}`);

  // 4. Set leadBonusPerEligible on the OFFICE 1 Etsy team (preserves Izaan's
  // existing formula). Skip if already set (idempotent).
  const etsyDept = await prisma.department.findFirst({
    where: { name: "Etsy", officeId: office1.id },
    include: { teams: true },
  });
  if (etsyDept) {
    for (const team of etsyDept.teams) {
      if (team.leadBonusPerEligible == null) {
        await prisma.team.update({
          where: { id: team.id },
          data: { leadBonusPerEligible: 5000 },
        });
        console.log(`  Team "${team.name}": leadBonusPerEligible set to 5000`);
      }
    }
  }

  // 5. Verification — raw SQL for the same reason as the UPDATEs above.
  console.log(`\n──── Verification ────`);
  const offices = await prisma.office.count();
  const [{ c: usersWithoutOffice }] = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "User" WHERE "officeId" IS NULL`;
  const [{ c: deptsWithoutOffice }] = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "Department" WHERE "officeId" IS NULL`;
  const [{ c: settingsWithoutOffice }] = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "OfficeSettings" WHERE "officeId" IS NULL`;
  const [{ c: snapshotsWithoutOffice }] = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "PayrollSnapshot" WHERE "officeId" IS NULL`;

  console.log(`  Offices total:                       ${offices}`);
  console.log(`  Users without officeId (must be 0):  ${usersWithoutOffice}`);
  console.log(`  Departments without officeId (0):    ${deptsWithoutOffice}`);
  console.log(`  OfficeSettings without officeId (0): ${settingsWithoutOffice}`);
  console.log(`  Snapshots without officeId (0):      ${snapshotsWithoutOffice}`);

  const zero = BigInt(0);
  const allGreen =
    offices === 1 &&
    usersWithoutOffice === zero &&
    deptsWithoutOffice === zero &&
    settingsWithoutOffice === zero &&
    snapshotsWithoutOffice === zero;

  console.log(`\n  ${allGreen ? "✅ All clear — backfill complete" : "❌ Some rows still NULL — investigate"}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
