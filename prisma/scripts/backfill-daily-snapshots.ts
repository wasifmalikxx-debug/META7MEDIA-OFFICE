/**
 * One-time backfill — populates DailyTeamSnapshot with the last 30 days of
 * Etsy team data so the CEO dashboard has historical context (MoM deltas,
 * trend charts) from day one.
 *
 * Reads both the current PKT month tab and the previous month's tab from
 * each employee's sheet, then runs the same aggregation the daily cron
 * does. Idempotent — re-running just updates the rows.
 *
 * Run:  npx tsx prisma/scripts/backfill-daily-snapshots.ts
 */

import { prisma } from "../../src/lib/prisma";
import { buildSnapshotsForMonth } from "../../src/lib/services/dashboard-snapshot.service";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

(async () => {
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const thisMonth = pkt.getUTCMonth() + 1;
  const thisYear = pkt.getUTCFullYear();
  const prevDate = new Date(Date.UTC(thisYear, thisMonth - 2, 1));
  const prevMonth = prevDate.getUTCMonth() + 1;
  const prevYear = prevDate.getUTCFullYear();

  console.log(`\nBackfilling DailyTeamSnapshot for last 2 months\n`);

  for (const { month, year, label } of [
    { month: prevMonth, year: prevYear, label: "previous" },
    { month: thisMonth, year: thisYear, label: "current" },
  ]) {
    console.log(`→ ${label} month: ${month}/${year}`);
    try {
      const result = await buildSnapshotsForMonth(month, year);
      console.log(
        `  ✓ ${result.rowsUpserted} rows · ${result.daysCovered} days · ${result.teamsCovered} teams\n`,
      );
    } catch (err: any) {
      console.error(`  ✗ failed: ${err.message}\n`);
    }
  }

  // Quick sanity dump
  const total = await prisma.dailyTeamSnapshot.count();
  const teams = await prisma.dailyTeamSnapshot.groupBy({
    by: ["teamKey"],
    _count: true,
    _sum: { orders: true, totalSale: true, grossProfit: true },
  });
  console.log(`\nTotal rows in DailyTeamSnapshot: ${total}\n`);
  console.log(`Per-team totals across the backfilled window:`);
  for (const t of teams) {
    console.log(
      `  ${t.teamKey.padEnd(6)} — ${t._count} days · ${t._sum.orders} orders · $${(t._sum.totalSale ?? 0).toFixed(2)} sale · $${(t._sum.grossProfit ?? 0).toFixed(2)} gross profit`,
    );
  }
  console.log();

  await prisma.$disconnect();
})().catch((err) => {
  console.error("Backfill failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
