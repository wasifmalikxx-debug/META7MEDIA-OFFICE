/**
 * One-time seed — populates the CEO's niche book with 15 curated
 * niches so Daily Trending has wide sourcing coverage from day one
 * without 15 manual modal clicks.
 *
 * Idempotent — re-running skips niches that already exist (the
 * unique constraint on [userId, niche] catches dupes). Won't blow
 * past the 15-cap because the picks ARE the cap.
 *
 * Run:  npx tsx prisma/scripts/seed-ceo-niches.ts
 *
 * To swap any niche: open Manage Niches inside Product Hunter →
 * Trending tab, remove + add. This script doesn't run again
 * automatically.
 */

import { prisma } from "../../src/lib/prisma";
import { normalizeNiche } from "../../src/lib/services/employee-niche.service";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Curated picks across the META7MEDIA shop categories:
//   • Jewelry (3) — covers our biggest revenue segment
//   • Wall art / decor (4) — high-margin, low-shipping items
//   • Gifts (3) — occasion-driven recurring demand
//   • Lifestyle / accessories (5) — broad-appeal, easy-listing items
const CEO_SEED_NICHES = [
  // Jewelry
  "boho jewelry",
  "minimalist jewelry",
  "silver jewelry",
  // Wall art + decor
  "cottagecore decor",
  "farmhouse wall art",
  "boho wall hanging",
  "macrame decor",
  // Gifts (occasion-driven)
  "baby shower gifts",
  "bridesmaid gifts",
  "anniversary gift",
  // Lifestyle + accessories
  "minimalist nursery",
  "witchy decor",
  "candle holder",
  "travel mug",
  "yoga gift",
];

(async () => {
  console.log("\nSeeding CEO niche book\n");

  const ceo = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  });
  if (!ceo) {
    console.error("No CEO user found (SUPER_ADMIN role). Aborting.");
    process.exit(1);
  }
  console.log(
    `CEO: ${ceo.firstName} ${ceo.lastName ?? ""} (${ceo.employeeId})`,
  );

  const existing = await prisma.employeeNiche.findMany({
    where: { userId: ceo.id },
    select: { niche: true },
  });
  const existingSet = new Set(existing.map((n) => n.niche));
  console.log(`Existing niches: ${existing.length}`);

  let added = 0;
  let skipped = 0;
  for (const raw of CEO_SEED_NICHES) {
    const niche = normalizeNiche(raw);
    if (existingSet.has(niche)) {
      skipped += 1;
      console.log(`  [skip] "${niche}" already in book`);
      continue;
    }
    try {
      await prisma.employeeNiche.create({
        data: { userId: ceo.id, niche, active: true },
      });
      added += 1;
      console.log(`  [add]  "${niche}"`);
    } catch (err) {
      console.warn(
        `  [fail] "${niche}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `\nDone — added ${added}, skipped ${skipped}, total now ${existing.length + added}`,
  );
  console.log(
    "Tomorrow's 5 AM PKT cron will fetch fresh AE trends for every niche.",
  );

  await prisma.$disconnect();
})();
