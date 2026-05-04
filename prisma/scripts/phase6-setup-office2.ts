import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Phase 6 — provision OFFICE 2 with the three partner-led teams and move
 * the existing Facebook team there.
 *
 * Idempotent: re-running produces no extra data. Safe to re-run.
 *
 * Steps:
 *   1. Ensure OFFICE 2 exists (slug "office-2", isPrimary=false).
 *   2. Clone OFFICE 1 settings to OFFICE 2 (so hours/fines match by default).
 *   3. Create three departments under OFFICE 2: Facebook, Etsy AE, Etsy ME.
 *   4. Create one team under each department.
 *   5. Create three partner Users (PARTNER role): Zain, Awais, Mubeen.
 *      Default password: partner123 (each partner should change immediately).
 *      Partners are NOT employees — no salary structure, no team membership;
 *      they manage teams via Team.partnerId.
 *   6. Wire Team.partnerId on each new team.
 *      - Etsy teams: leadBonusPerEligible = NULL (no team-lead bonus per office rule).
 *   7. Move all current SMM-* (Facebook) employees from OFFICE 1 to OFFICE 2:
 *      - officeId, departmentId, teamId, managerId all updated atomically.
 *      - History (attendance, fines, leaves, payroll) preserved as-is.
 *
 * Critical: this script ONLY shifts FB employees' organizational pointers.
 * Their existing rows in Attendance/Fine/LeaveRequest/PayrollRecord stay
 * exactly as they were — those tables don't carry officeId. Reading them
 * back via the new partner-scoped queries (which join through user.officeId
 * and user.teamId) will surface the same history under Zain's view.
 */
async function main() {
  console.log("Phase 6 — provisioning OFFICE 2\n");

  // 1. OFFICE 2
  const office2 = await prisma.office.upsert({
    where: { slug: "office-2" },
    update: {},
    create: {
      slug: "office-2",
      name: "META7MEDIA OFFICE 2",
      isPrimary: false,
    },
  });
  console.log(`  Office: ${office2.slug} (${office2.id})`);

  // 2. Clone OFFICE 1 settings to OFFICE 2
  const office1 = await prisma.office.findFirst({ where: { isPrimary: true } });
  if (!office1) throw new Error("OFFICE 1 not found — Phase 2 not run?");
  const office1Settings = await prisma.officeSettings.findUnique({ where: { officeId: office1.id } });
  if (!office1Settings) throw new Error("OFFICE 1 settings not found");

  const existingOffice2Settings = await prisma.officeSettings.findUnique({ where: { officeId: office2.id } });
  if (!existingOffice2Settings) {
    // Strip id + officeId from the source so Prisma generates new ones
    const { id: _id, officeId: _officeId, updatedAt: _u, ...rest } = office1Settings as any;
    await prisma.officeSettings.create({
      data: {
        ...rest,
        officeName: "META7MEDIA OFFICE 2",
        officeId: office2.id,
      },
    });
    console.log(`  OfficeSettings: cloned from OFFICE 1 → OFFICE 2`);
  } else {
    console.log(`  OfficeSettings: already exists for OFFICE 2`);
  }

  // 3. Departments under OFFICE 2
  const deptDefs = [
    { name: "Facebook", note: "Zain's FB team (moved from OFFICE 1)" },
    { name: "Etsy AE", note: "Awais's Etsy team (AE-* employees)" },
    { name: "Etsy ME", note: "Mubeen's Etsy team (ME-* employees)" },
  ];
  const departments: Record<string, string> = {};
  for (const d of deptDefs) {
    const dept = await prisma.department.upsert({
      where: { name_officeId: { name: d.name, officeId: office2.id } },
      update: {},
      create: { name: d.name, officeId: office2.id },
    });
    departments[d.name] = dept.id;
    console.log(`  Dept "${d.name}": ${dept.id}`);
  }

  // 4. Teams (one per department)
  const teamDefs = [
    { name: "Facebook Team",     deptName: "Facebook",  partnerEmail: "zain@meta7.media",   leadBonus: null },
    { name: "Etsy AE Team",      deptName: "Etsy AE",   partnerEmail: "awais@meta7.media",  leadBonus: null },
    { name: "Etsy ME Team",      deptName: "Etsy ME",   partnerEmail: "mubeen@meta7.media", leadBonus: null },
  ];

  // 5. Partner users (PARTNER role, no salary, no team membership)
  // Default password Meta@123 — partners should reset on first login.
  const password = await bcrypt.hash("Meta@123", 12);
  const today = new Date();
  const partnerDefs = [
    { employeeId: "PR-1", email: "zain@meta7.media",   firstName: "Zain",   lastName: "(Partner)" },
    { employeeId: "PR-2", email: "awais@meta7.media",  firstName: "Awais",  lastName: "(Partner)" },
    { employeeId: "PR-3", email: "mubeen@meta7.media", firstName: "Mubeen", lastName: "(Partner)" },
  ];
  const partners: Record<string, { id: string; name: string }> = {};
  for (const p of partnerDefs) {
    const partner = await prisma.user.upsert({
      where: { email: p.email },
      update: {
        // If the partner already exists, ensure their role is PARTNER and they're on OFFICE 2.
        role: "PARTNER",
        officeId: office2.id,
      },
      create: {
        employeeId: p.employeeId,
        email: p.email,
        password,
        firstName: p.firstName,
        lastName: p.lastName,
        role: "PARTNER",
        status: "HIRED",
        designation: "Partner",
        officeId: office2.id,
        joiningDate: today,
        // No salaryStructure — partners aren't employees, no payroll line.
        // No teamId — partners manage teams via Team.partnerId, not membership.
      },
    });
    partners[p.email] = { id: partner.id, name: `${p.firstName} ${p.lastName}` };
    console.log(`  Partner: ${p.firstName} (${p.employeeId}, ${p.email})`);
  }

  // 6. Teams + partnerId wiring
  const teams: Record<string, { id: string; name: string; partnerId: string }> = {};
  for (const t of teamDefs) {
    const partnerId = partners[t.partnerEmail].id;
    const team = await prisma.team.upsert({
      where: { name_departmentId: { name: t.name, departmentId: departments[t.deptName] } },
      update: { partnerId, leadBonusPerEligible: t.leadBonus },
      create: {
        name: t.name,
        departmentId: departments[t.deptName],
        partnerId,
        leadBonusPerEligible: t.leadBonus,
      },
    });
    teams[t.deptName] = { id: team.id, name: team.name, partnerId };
    console.log(`  Team "${t.name}": ${team.id} (partner=${partners[t.partnerEmail].name})`);
  }

  // 7. Move existing Facebook (SMM-*) employees from OFFICE 1 → OFFICE 2
  const fbDeptOffice2Id = departments["Facebook"];
  const fbTeamId = teams["Facebook"].id;
  const zainId = partners["zain@meta7.media"].id;

  const smmEmployees = await prisma.user.findMany({
    where: { employeeId: { startsWith: "SMM-" } },
    select: { id: true, employeeId: true, firstName: true, lastName: true, officeId: true, departmentId: true, teamId: true, managerId: true },
  });

  console.log(`\n  Moving ${smmEmployees.length} Facebook employees to OFFICE 2:`);
  let moved = 0;
  let alreadyMoved = 0;
  for (const emp of smmEmployees) {
    const needsMove =
      emp.officeId !== office2.id ||
      emp.departmentId !== fbDeptOffice2Id ||
      emp.teamId !== fbTeamId ||
      emp.managerId !== zainId;

    if (!needsMove) {
      alreadyMoved++;
      continue;
    }

    await prisma.user.update({
      where: { id: emp.id },
      data: {
        officeId: office2.id,
        departmentId: fbDeptOffice2Id,
        teamId: fbTeamId,
        managerId: zainId,
      },
    });
    console.log(`    ✓ ${emp.employeeId} ${emp.firstName} ${emp.lastName} → OFFICE 2 / Facebook / Zain`);
    moved++;
  }
  if (alreadyMoved > 0) console.log(`    (${alreadyMoved} employees already on OFFICE 2 — no change)`);

  // 8. Verification
  console.log(`\n──── Verification ────`);
  const office2Users = await prisma.user.count({ where: { officeId: office2.id } });
  const office2NonPartnerUsers = await prisma.user.count({ where: { officeId: office2.id, role: { not: "PARTNER" } } });
  const office1Users = await prisma.user.count({ where: { officeId: office1.id } });
  const office2Teams = await prisma.team.count({ where: { department: { officeId: office2.id } } });
  console.log(`  OFFICE 2 users:                  ${office2Users} (3 partners + ${office2NonPartnerUsers} employees)`);
  console.log(`  OFFICE 1 users:                  ${office1Users} (Etsy + admin)`);
  console.log(`  OFFICE 2 teams:                  ${office2Teams}`);
  console.log(`  FB employees (SMM-*) on OFFICE 2: ${smmEmployees.length} (moved=${moved}, already=${alreadyMoved})`);

  console.log(`\n  ✅ OFFICE 2 provisioned. Partners: zain@, awais@, mubeen@meta7media.com — password "partner123"`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
