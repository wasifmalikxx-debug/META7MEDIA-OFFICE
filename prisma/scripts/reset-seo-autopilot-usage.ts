/**
 * One-off admin script — wipe TODAY's SEO Autopilot quota counters.
 *
 * Why: post-EM-team rollout (May 15 2026), Wasif wants the team to
 * start the day with a clean 8/day so they can test freely.
 *
 * What it does:
 *   - Deletes every row in SeoAutopilotUsage where date == today (PKT).
 *   - That's it — SeoAutopilotLog (history) and SeoAutopilotTagSwapLog
 *     (audit) are NOT touched. Only the quota counter resets.
 *
 * Run against PROD (default `.env`):
 *   npx tsx prisma/scripts/reset-seo-autopilot-usage.ts
 *
 * Run against LOCAL:
 *   DATABASE_URL="postgresql://wasifmalik@localhost:5432/meta7media_office_dev" \
 *     npx tsx prisma/scripts/reset-seo-autopilot-usage.ts
 *
 * After: each user's next /api/seo-autopilot/generate call creates a
 * fresh row at count=1, giving them their full 8 generations for today.
 */

import { prisma } from "../../src/lib/prisma";
import { pktDateAsUtcMidnight } from "../../src/lib/services/seo-autopilot-quota.service";

async function main() {
  const today = pktDateAsUtcMidnight();
  console.log(`Resetting SEO Autopilot usage for PKT date: ${today.toISOString().slice(0, 10)}`);

  // Quick peek at who's affected before we delete
  const before = await prisma.seoAutopilotUsage.findMany({
    where: { date: today },
    select: {
      userId: true,
      count: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          employeeId: true,
          role: true,
        },
      },
    },
    orderBy: { count: "desc" },
  });

  if (before.length === 0) {
    console.log("No usage rows for today yet — nothing to reset.");
    return;
  }

  console.log(`\nFound ${before.length} user(s) with usage today:`);
  for (const row of before) {
    const name = `${row.user.firstName} ${row.user.lastName}`.trim();
    console.log(
      `  - ${name || row.userId} (${row.user.employeeId ?? row.user.role}) — ${row.count} gens`,
    );
  }

  const result = await prisma.seoAutopilotUsage.deleteMany({
    where: { date: today },
  });

  console.log(`\n✓ Reset complete. Deleted ${result.count} usage row(s).`);
  console.log(`Everyone now has the full 8/day quota for today.`);
}

main()
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
