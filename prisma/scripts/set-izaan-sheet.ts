/**
 * One-off: assign Izaan (EM-4) his Google Sheet URL so the sync-profits
 * cron + etsy-analytics start including his shops in the bonus pipeline.
 *
 * CONTEXT: May 19 2026 — Izaan now runs his own shops alongside managing
 * the EM team. Sheet URL provided by the CEO; portal already has viewer
 * access. After this script runs, the next /api/cron/sync-profits tick
 * will read Izaan's sheet, compute his bonus eligibility from the same
 * 7-criteria formula every other EM seller uses, and create/update his
 * Profit Bonus incentive. The team-lead bonus tally continues to
 * exclude EM-4 from its eligible count so his own row never inflates
 * his team-lead payout (no double-dip).
 *
 * RUN:
 *   npx tsx prisma/scripts/set-izaan-sheet.ts
 *
 * IDEMPOTENT: re-running with the same URL is a no-op write.
 */

import { PrismaClient } from "@prisma/client";

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1hPFBsbKOzXS_FB6sh7oADf2hLAAp-38SyF0IvRk91PI/edit?gid=1201369454#gid=1201369454";

const prisma = new PrismaClient();

async function main() {
  const izaan = await prisma.user.findUnique({
    where: { employeeId: "EM-4" },
    select: { id: true, firstName: true, lastName: true, googleSheetUrl: true },
  });

  if (!izaan) {
    console.error("✗ Izaan (EM-4) not found in users table.");
    process.exit(1);
  }

  if (izaan.googleSheetUrl === SHEET_URL) {
    console.log(`✓ Izaan's sheet URL already set — no change needed.`);
    console.log(`  URL: ${SHEET_URL}`);
    return;
  }

  console.log(
    `Updating Izaan (${izaan.firstName} ${izaan.lastName || ""}):`,
  );
  console.log(`  before: ${izaan.googleSheetUrl ?? "(unset)"}`);
  console.log(`  after:  ${SHEET_URL}`);

  await prisma.user.update({
    where: { id: izaan.id },
    data: { googleSheetUrl: SHEET_URL },
  });

  console.log(`✓ Done. Next sync-profits run will pick up his shops.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
