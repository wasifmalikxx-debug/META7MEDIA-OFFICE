import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed Awais's Etsy AE team (AE-1..AE-7) with the real names supplied by
 * the user + Google Sheet URLs already shared with the service account.
 *
 * Real hires (status=HIRED, name + phone known):
 *   AE-1 Abdullah Khan        03264661917
 *   AE-2 Muhammad Sajid       03206878210
 *   AE-3 Ali Awais            03001188093
 *   AE-4 Ali Afzal            03177102391
 *   AE-5 Tauseen Masood       03164564122
 *
 * Placeholder slots (status=PROBATION, name "NOT HIRED"):
 *   AE-6, AE-7 — Awais edits when an actual person fills the slot.
 *   PROBATION keeps them out of the daily-absent fine cron and the bonus
 *   sync until Awais flips them to HIRED.
 *
 * Idempotent: re-running with the same data produces no extra rows. Mirrors
 * `seed-me-team.ts` exactly so behavior matches Mubeen's team setup.
 */

const PASSWORD_PLAINTEXT = "Meta@123";
const SALARY_PKR = 30000;

const SHEET_URLS: Record<string, string> = {
  "AE-1": "https://docs.google.com/spreadsheets/d/1hwCPcJfQjhqoaWJn3WS7HEWrJaZIt2D2tAAHw1xr8zk/edit",
  "AE-2": "https://docs.google.com/spreadsheets/d/13mEOL-B7ISgRAuEa0IrU9TPMNNtdVe_WJdXAKmL8_6Y/edit",
  "AE-3": "https://docs.google.com/spreadsheets/d/114eWmwZ5YiQxIIp371RaoyFxPY4F5Bcg4BIFqIkrbmo/edit",
  "AE-4": "https://docs.google.com/spreadsheets/d/191HU9bdS9GXzHPq3cVywlcVKxH4xwRVASvWVKf-y5p4/edit",
  "AE-5": "https://docs.google.com/spreadsheets/d/1VtO2OP4s0jQW2kW2m6-ILhYIgC0VlPiQYp06XhwI4qU/edit",
  "AE-6": "https://docs.google.com/spreadsheets/d/1oeh26oleNM0tNykd1oiKdVnsKp5HVYgYw-IDkfyLe4g/edit",
  "AE-7": "https://docs.google.com/spreadsheets/d/1jK2viWLbDDSXcrIpgI9-lQpioDBPDLfXL71z0OuLHHs/edit",
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
  { employeeId: "AE-1", email: "ae1@meta7.media", firstName: "Abdullah",      lastName: "Khan",    phone: "03264661917", status: "HIRED" },
  { employeeId: "AE-2", email: "ae2@meta7.media", firstName: "Muhammad",      lastName: "Sajid",   phone: "03206878210", status: "HIRED" },
  { employeeId: "AE-3", email: "ae3@meta7.media", firstName: "Ali",           lastName: "Awais",   phone: "03001188093", status: "HIRED" },
  { employeeId: "AE-4", email: "ae4@meta7.media", firstName: "Ali",           lastName: "Afzal",   phone: "03177102391", status: "HIRED" },
  { employeeId: "AE-5", email: "ae5@meta7.media", firstName: "Tauseen",       lastName: "Masood",  phone: "03164564122", status: "HIRED" },
  { employeeId: "AE-6", email: "ae6@meta7.media", firstName: "NOT HIRED",     lastName: "",        phone: null,          status: "PROBATION" },
  { employeeId: "AE-7", email: "ae7@meta7.media", firstName: "NOT HIRED",     lastName: "",        phone: null,          status: "PROBATION" },
];

async function main() {
  console.log("Seeding Awais's Etsy AE team\n");

  const office2 = await prisma.office.findUnique({ where: { slug: "office-2" } });
  if (!office2) throw new Error("OFFICE 2 not found — run phase6-setup-office2 first");

  const aeDept = await prisma.department.findFirst({
    where: { name: "Etsy - AE", officeId: office2.id },
  });
  if (!aeDept) throw new Error("'Etsy - AE' department not found in OFFICE 2");

  const awaisTeam = await prisma.team.findFirst({
    where: { departmentId: aeDept.id, name: { contains: "Awais" } },
  });
  if (!awaisTeam) throw new Error("Awais's team not found");
  if (!awaisTeam.partnerId) throw new Error("Awais team has no partnerId set");

  console.log(`  Office:     ${office2.slug} (${office2.id})`);
  console.log(`  Department: ${aeDept.name} (${aeDept.id})`);
  console.log(`  Team:       ${awaisTeam.name} (${awaisTeam.id})`);
  console.log(`  Manager:    Awais partner (${awaisTeam.partnerId})\n`);

  const password = await bcrypt.hash(PASSWORD_PLAINTEXT, 12);
  const today = new Date();

  let created = 0;
  let updated = 0;

  for (const slot of SLOTS) {
    const url = SHEET_URLS[slot.employeeId];

    const user = await prisma.user.upsert({
      where: { employeeId: slot.employeeId },
      update: {
        // Refresh source-of-truth fields. Don't overwrite password so manual
        // resets stick across re-runs.
        email: slot.email,
        firstName: slot.firstName,
        lastName: slot.lastName,
        phone: slot.phone,
        status: slot.status,
        googleSheetUrl: url,
        officeId: office2.id,
        departmentId: aeDept.id,
        teamId: awaisTeam.id,
        managerId: awaisTeam.partnerId,
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
        designation: "Etsy AE",
        joiningDate: today,
        officeId: office2.id,
        departmentId: aeDept.id,
        teamId: awaisTeam.id,
        managerId: awaisTeam.partnerId,
        googleSheetUrl: url,
      },
    });

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

  console.log(`\n  ✅ AE team seeded — created ${created}, updated ${updated}`);
  console.log(`     Password for new entries: "${PASSWORD_PLAINTEXT}" — Awais should reset.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
