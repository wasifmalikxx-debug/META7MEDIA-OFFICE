/**
 * Quick diagnostic — connects to whichever DB is in the env and dumps the
 * current state of DailyTeamSnapshot. Used to see if the cron has been
 * populating data and whether the dashboard's financial sections should
 * have something to render.
 *
 * Run against prod:
 *   DATABASE_URL="<prod url>" npx tsx prisma/scripts/check-snapshot-state.ts
 *
 * Run against local (default — uses .env.local):
 *   npx tsx prisma/scripts/check-snapshot-state.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

// Order matters — explicit DATABASE_URL on CLI wins over both files.
// If no override, .env.local takes precedence over .env.
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" });
  dotenv.config({ path: ".env" });
}

(async () => {
  const prisma = new PrismaClient();
  const target = process.env.DATABASE_URL ?? "(unset)";
  const safeTarget = target.replace(/:[^@]+@/, ":***@");
  console.log(`\nDailyTeamSnapshot diagnostic`);
  console.log(`Target: ${safeTarget}\n`);

  const total = await prisma.dailyTeamSnapshot.count();
  console.log(`Total rows: ${total}`);
  if (total === 0) {
    console.log(`\n(empty) — the daily cron hasn't populated yet, or the`);
    console.log(`backfill script hasn't been run.`);
    await prisma.$disconnect();
    return;
  }

  const earliest = await prisma.dailyTeamSnapshot.findFirst({
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const latest = await prisma.dailyTeamSnapshot.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  console.log(`Date range: ${earliest?.date.toISOString().slice(0, 10)} → ${latest?.date.toISOString().slice(0, 10)}`);

  const perTeam = await prisma.dailyTeamSnapshot.groupBy({
    by: ["teamKey"],
    _count: true,
    _sum: { orders: true, totalSale: true, grossProfit: true },
    orderBy: { teamKey: "asc" },
  });
  console.log(`\nPer-team rollup:`);
  for (const t of perTeam) {
    console.log(
      `  ${t.teamKey.padEnd(6)} ${String(t._count).padStart(4)} days · ${String(t._sum.orders ?? 0).padStart(4)} orders · $${(t._sum.totalSale ?? 0).toFixed(2).padStart(10)} sale · $${(t._sum.grossProfit ?? 0).toFixed(2).padStart(10)} gross profit`,
    );
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
