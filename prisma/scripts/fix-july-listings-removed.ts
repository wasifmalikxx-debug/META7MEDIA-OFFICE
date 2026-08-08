/**
 * ONE-OFF (2026-08-06): restore the CEO's July listings-removed counts that the
 * bonus-program stale-state glitch reverted (his repair today left 8 / 4).
 * CEO-stated truth: Kashan (EM-7) = 11, Musa (EM-4B) = 5 for July 2026.
 * SAFETY: only touches listingsRemovedCount on those two July rows. Both rows
 * are (and must remain) isEligible=false — count > 3 fails criterion 5 either
 * way — so bonusAmount/incentives/payroll are untouched by design; the script
 * aborts if any precondition doesn't hold.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parse } from "dotenv";
import { PrismaClient } from "@prisma/client";

const env = parse(readFileSync(join(process.cwd(), ".env")));
const url = env.DIRECT_URL || env.DATABASE_URL || "";
if (!/supabase\.com/.test(url)) { console.error("ABORT: not prod"); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } }, log: ["error"] });

const TARGETS = [
  { employeeId: "EM-7", expectCurrent: 8, setTo: 11 },
  { employeeId: "EM-4B", expectCurrent: 4, setTo: 5 },
];

async function main() {
  for (const t of TARGETS) {
    const user = await prisma.user.findFirst({ where: { employeeId: t.employeeId }, select: { id: true, firstName: true, lastName: true } });
    if (!user) { console.error(`ABORT: ${t.employeeId} not found`); process.exit(1); }

    const row = await prisma.bonusEligibility.findUnique({
      where: { userId_month_year: { userId: user.id, month: 7, year: 2026 } },
    });
    if (!row) { console.error(`ABORT: no July-2026 row for ${t.employeeId}`); process.exit(1); }
    if (row.isEligible !== false || row.bonusAmount !== 0) {
      console.error(`ABORT: ${t.employeeId} July row is eligible/bonused (eligible=${row.isEligible}, bonus=${row.bonusAmount}) — manual review needed`);
      process.exit(1);
    }
    if (row.listingsRemovedCount !== t.expectCurrent) {
      console.error(`ABORT: ${t.employeeId} July listingsRemovedCount is ${row.listingsRemovedCount}, expected ${t.expectCurrent} — data moved since diagnosis, re-check first`);
      process.exit(1);
    }

    const updated = await prisma.bonusEligibility.update({
      where: { id: row.id },
      data: { listingsRemovedCount: t.setTo },
    });
    console.log(`✔ ${t.employeeId} ${user.firstName} ${user.lastName || ""}: July listingsRemoved ${t.expectCurrent} → ${updated.listingsRemovedCount} (eligible stays ${updated.isEligible}, bonus ${updated.bonusAmount})`);
  }
  console.log("\nDone — July counts restored per CEO. No eligibility/payroll side effects.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
