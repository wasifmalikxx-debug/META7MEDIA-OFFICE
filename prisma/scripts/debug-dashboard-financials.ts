/**
 * Debug — runs the dashboard-financials aggregator against prod data
 * and dumps every intermediate value so we can see why today's profit
 * shows $0.00 on the live dashboard.
 */
import { PrismaClient } from "@prisma/client";
import { buildDashboardFinancials } from "../../src/lib/services/dashboard-financials";
import { nowPKT, pktMonth, pktYear } from "../../src/lib/pkt";

(async () => {
  const prisma = new PrismaClient();
  const month = pktMonth();
  const year = pktYear();
  const pkt = nowPKT();

  console.log(`\nDebug snapshot vs financials`);
  console.log(`PKT now: ${pkt.toISOString()}`);
  console.log(`PKT month/year: ${month}/${year}`);
  console.log(`PKT day of month: ${pkt.getUTCDate()}`);
  console.log(``);

  // Fetch snapshots the same way the dashboard does.
  const snapshots = await prisma.dailyTeamSnapshot.findMany({
    where: {
      date: {
        gte: new Date(Date.UTC(year, month - 2, 1)),
        lte: new Date(Date.UTC(year, month, 7)),
      },
    },
    orderBy: { date: "asc" },
  });
  console.log(`Snapshots fetched: ${snapshots.length}`);
  if (snapshots.length > 0) {
    console.log(`First: ${snapshots[0].date.toISOString()} ${snapshots[0].teamKey} · $${snapshots[0].totalSale.toFixed(2)}`);
    console.log(`Last:  ${snapshots[snapshots.length - 1].date.toISOString()} ${snapshots[snapshots.length - 1].teamKey} · $${snapshots[snapshots.length - 1].totalSale.toFixed(2)}`);
  }

  // Look for "today" snapshot specifically.
  const dayOfMonth = pkt.getUTCDate();
  const todayMidnight = new Date(Date.UTC(year, month - 1, dayOfMonth));
  console.log(`\nLooking for today's row: ${todayMidnight.toISOString()}`);
  const todayRows = snapshots.filter(
    (s) =>
      s.date.getUTCFullYear() === todayMidnight.getUTCFullYear() &&
      s.date.getUTCMonth() === todayMidnight.getUTCMonth() &&
      s.date.getUTCDate() === todayMidnight.getUTCDate(),
  );
  console.log(`Matching today rows: ${todayRows.length}`);
  for (const r of todayRows) {
    console.log(`  ${r.teamKey}: ${r.orders} orders · $${r.totalSale.toFixed(2)} sale · $${r.grossProfit.toFixed(2)} profit`);
  }

  // Run the actual aggregator.
  const result = buildDashboardFinancials(snapshots, [], month, year, pkt);
  console.log(`\nAggregator output:`);
  console.log(`  combined.today:    ${JSON.stringify(result.combined.today)}`);
  console.log(`  combined.mtd:      ${JSON.stringify(result.combined.mtd)}`);
  console.log(`  combined.lastMTD:  ${JSON.stringify(result.combined.lastMonthSameDay)}`);
  console.log(`  combined.lastFull: ${JSON.stringify(result.combined.lastMonthFull)}`);
  console.log(`  dailySeries length: ${result.dailySeries.length}`);
  console.log(`  first 3 dailySeries:`);
  for (const d of result.dailySeries.slice(-3)) {
    console.log(`    ${d.date}: $${d.sale.toFixed(2)} sale · $${d.profit.toFixed(2)} profit`);
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
