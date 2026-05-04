import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Normalize all partner-team credentials to the new prod-ready format:
 *   - AE-N employees → email "aeN@meta7.media", password Meta@123
 *   - ME-N employees → email "meN@meta7.media", password Meta@123
 *   - Partners (Zain/Awais/Mubeen) → password Meta@123 (emails kept as-is)
 *
 * The seed scripts deliberately don't overwrite passwords on update (so manual
 * resets stick on re-runs). This script is the one-off counter-measure for the
 * existing local DB which had the old "welcome123" / "partner123" defaults.
 *
 * Idempotent — always sets to target state regardless of current state.
 */

const NEW_PASSWORD = "Meta@123";

async function main() {
  console.log(`Resetting AE/ME/partner credentials to ${NEW_PASSWORD}\n`);

  const password = await bcrypt.hash(NEW_PASSWORD, 12);

  // ─── AE-1..AE-7 ─────────────────────────────────────────────────
  for (let i = 1; i <= 7; i++) {
    const employeeId = `AE-${i}`;
    const newEmail = `ae${i}@meta7.media`;
    const u = await prisma.user.findUnique({ where: { employeeId }, select: { id: true, email: true } });
    if (!u) {
      console.log(`  · ${employeeId}  (not in DB — skipped)`);
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { email: newEmail, password },
    });
    console.log(`  ↻ ${employeeId}  ${u.email} → ${newEmail}`);
  }

  // ─── ME-1..ME-7 ─────────────────────────────────────────────────
  for (let i = 1; i <= 7; i++) {
    const employeeId = `ME-${i}`;
    const newEmail = `me${i}@meta7.media`;
    const u = await prisma.user.findUnique({ where: { employeeId }, select: { id: true, email: true } });
    if (!u) {
      console.log(`  · ${employeeId}  (not in DB — skipped)`);
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { email: newEmail, password },
    });
    console.log(`  ↻ ${employeeId}  ${u.email} → ${newEmail}`);
  }

  // ─── Partners ───────────────────────────────────────────────────
  const partnerEmails = ["zain@meta7.media", "awais@meta7.media", "mubeen@meta7.media"];
  for (const email of partnerEmails) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, firstName: true } });
    if (!u) {
      console.log(`  · partner ${email}  (not in DB — skipped)`);
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { password },
    });
    console.log(`  ↻ partner ${u.firstName} (${email})  password reset`);
  }

  console.log(`\n  ✅ Credentials reset. New password: ${NEW_PASSWORD}`);
  console.log(`     Logins: ae1..ae7@meta7.media, me1..me7@meta7.media, zain/awais/mubeen@meta7.media`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
