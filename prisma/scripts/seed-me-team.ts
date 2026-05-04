import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed Mubeen's Etsy ME team (ME-1..ME-7) with the real names supplied by
 * the user + Google Sheet URLs already shared with the service account.
 *
 * Real hires (status=HIRED, name + phone known):
 *   ME-1 Muhammad Hamza Aamir Siddiqi   0309-8280114
 *   ME-2 Muhammad Talha                 03443475652
 *   ME-3 Nabeel                         03107964365
 *   ME-5 Ahmad Mehmood                  03216701159
 *
 * Placeholder slots (status=PROBATION, name "NOT HIRED"):
 *   ME-4, ME-6, ME-7 — Mubeen edits when an actual person fills the slot.
 *   PROBATION keeps them out of the daily-absent fine cron and the bonus
 *   sync until Mubeen flips them to HIRED.
 *
 * Existing ME-1 (currently "Abdullah Khan" — original test entry) is updated
 * in place (same row, same employeeId) with the real person's data. Idempotent:
 * re-running with the same data produces no extra rows.
 */

const PASSWORD_PLAINTEXT = "Meta@123";
const SALARY_PKR = 30000;

const SHEET_URLS: Record<string, string> = {
  "ME-1": "https://docs.google.com/spreadsheets/d/1VrztP8PliEdjloUyzJBQRqxQdBZVADyeBP_FcSC35hU/edit",
  "ME-2": "https://docs.google.com/spreadsheets/d/1mbxdEoZ1yHSlEtsSGPN-ECXp0xg4A4wmNbs7n5M6jjY/edit",
  "ME-3": "https://docs.google.com/spreadsheets/d/1D9v9af89gTEPd3o9cfNbXqG9Dvv5kdyWtsuvSbUhCaE/edit",
  "ME-4": "https://docs.google.com/spreadsheets/d/137TkbnRSuG4qtR91wT2U4YOsR2xhuppiGWqD5CdKmS0/edit",
  "ME-5": "https://docs.google.com/spreadsheets/d/1NP9tZvHd4xqAtlRkUTDpdd_EmWV0WfvZpfEwtTyXgSA/edit",
  "ME-6": "https://docs.google.com/spreadsheets/d/1XvetwhqXtMHlZ1YgSVGW7DbSGBp0DOcHSidXZs-2lKc/edit",
  "ME-7": "https://docs.google.com/spreadsheets/d/1OnFA21D9brDw4sgCynKMUEezw_SwN166GbXWRzJeaX4/edit",
};

interface Slot {
  employeeId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  status: "HIRED" | "PROBATION";
}

const SLOTS: Slot[] = [
  { employeeId: "ME-1", email: "me1@meta7.media", firstName: "Muhammad Hamza", lastName: "Aamir Siddiqi", phone: "03098280114", status: "HIRED" },
  { employeeId: "ME-2", email: "me2@meta7.media", firstName: "Muhammad",       lastName: "Talha",          phone: "03443475652", status: "HIRED" },
  { employeeId: "ME-3", email: "me3@meta7.media", firstName: "Nabeel",         lastName: "",               phone: "03107964365", status: "HIRED" },
  { employeeId: "ME-4", email: "me4@meta7.media", firstName: "NOT HIRED",      lastName: "",               phone: null,          status: "PROBATION" },
  { employeeId: "ME-5", email: "me5@meta7.media", firstName: "Ahmad",          lastName: "Mehmood",        phone: "03216701159", status: "HIRED" },
  { employeeId: "ME-6", email: "me6@meta7.media", firstName: "NOT HIRED",      lastName: "",               phone: null,          status: "PROBATION" },
  { employeeId: "ME-7", email: "me7@meta7.media", firstName: "NOT HIRED",      lastName: "",               phone: null,          status: "PROBATION" },
];

async function main() {
  console.log("Seeding Mubeen's Etsy ME team\n");

  // Resolve org context: OFFICE 2 / Etsy - ME / Mubeen Team / Mubeen partner
  const office2 = await prisma.office.findUnique({ where: { slug: "office-2" } });
  if (!office2) throw new Error("OFFICE 2 not found — run phase6-setup-office2 first");

  const meDept = await prisma.department.findFirst({
    where: { name: "Etsy - ME", officeId: office2.id },
  });
  if (!meDept) throw new Error("'Etsy - ME' department not found in OFFICE 2");

  const mubeenTeam = await prisma.team.findFirst({
    where: { departmentId: meDept.id, name: { contains: "Mubeen" } },
  });
  if (!mubeenTeam) throw new Error("Mubeen's team not found");
  if (!mubeenTeam.partnerId) throw new Error("Mubeen team has no partnerId set");

  console.log(`  Office:     ${office2.slug} (${office2.id})`);
  console.log(`  Department: ${meDept.name} (${meDept.id})`);
  console.log(`  Team:       ${mubeenTeam.name} (${mubeenTeam.id})`);
  console.log(`  Manager:    Mubeen partner (${mubeenTeam.partnerId})\n`);

  const password = await bcrypt.hash(PASSWORD_PLAINTEXT, 12);
  const today = new Date();

  let created = 0;
  let updated = 0;

  for (const slot of SLOTS) {
    const url = SHEET_URLS[slot.employeeId];

    const user = await prisma.user.upsert({
      where: { employeeId: slot.employeeId },
      update: {
        // Only fields safe to overwrite on re-run. We refresh the names + phone
        // + sheet URL + status to match the current source of truth, but DON'T
        // overwrite the password (so manual resets stick).
        email: slot.email,
        firstName: slot.firstName,
        lastName: slot.lastName,
        phone: slot.phone,
        status: slot.status,
        googleSheetUrl: url,
        // Make sure the org pointers are correct in case the row was created
        // earlier under different IDs.
        officeId: office2.id,
        departmentId: meDept.id,
        teamId: mubeenTeam.id,
        managerId: mubeenTeam.partnerId,
        role: "EMPLOYEE",
      },
      create: {
        employeeId: slot.employeeId,
        email: slot.email,
        password,
        firstName: slot.firstName,
        lastName: slot.lastName,
        phone: slot.phone,
        role: "EMPLOYEE",
        status: slot.status,
        designation: "Etsy ME",
        joiningDate: today,
        officeId: office2.id,
        departmentId: meDept.id,
        teamId: mubeenTeam.id,
        managerId: mubeenTeam.partnerId,
        googleSheetUrl: url,
      },
    });

    // Salary structure: PKR 30,000 monthly, no tax / SS / other deductions.
    // upsert by userId (1:1 relation).
    await prisma.salaryStructure.upsert({
      where: { userId: user.id },
      update: {
        monthlySalary: SALARY_PKR,
        currency: "PKR",
      },
      create: {
        userId: user.id,
        monthlySalary: SALARY_PKR,
        currency: "PKR",
        taxPercent: 0,
        socialSecurity: 0,
        otherDeductions: 0,
        effectiveFrom: today,
      },
    });

    const isUpdate = user.createdAt.getTime() < Date.now() - 5_000;
    if (isUpdate) updated++;
    else created++;

    console.log(
      `  ${isUpdate ? "↻" : "+"} ${slot.employeeId}  ${slot.firstName} ${slot.lastName || ""}`.trim() +
      `  [${slot.status}]  ${slot.phone ?? "no phone"}`,
    );
  }

  console.log(`\n  ✅ ME team seeded — created ${created}, updated ${updated}`);
  console.log(`     Password for new entries: "${PASSWORD_PLAINTEXT}" — Mubeen should reset.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
