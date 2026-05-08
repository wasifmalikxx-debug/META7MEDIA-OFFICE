/**
 * One-off cleanup: Izaan accumulated cross-team refund notifications under
 * the old hardcoded routing (every refund notified him regardless of team).
 * The code is fixed forward — this script clears the existing stale rows
 * from his bell.
 *
 * Targets only notifications on Izaan's account whose message references an
 * AE-* or ME-* employee (i.e., not his EM team). EM-* refunds stay; he
 * legitimately manages those.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const izaan = await prisma.user.findFirst({
    where: { employeeId: "EM-4" },
    select: { id: true, firstName: true },
  });
  if (!izaan) {
    console.log("Izaan (EM-4) not found");
    return;
  }
  console.log(`Cleaning stale cross-team notifications for ${izaan.firstName} (${izaan.id})\n`);

  // Refund notifications referencing AE-* or ME-* in the message body
  const candidates = await prisma.notification.findMany({
    where: {
      userId: izaan.id,
      OR: [
        { title: { contains: "refund", mode: "insensitive" } },
        { message: { contains: "refund", mode: "insensitive" } },
      ],
    },
    select: { id: true, title: true, message: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const stale = candidates.filter((n) => {
    const text = `${n.title} ${n.message}`;
    return /\((AE|ME)-/.test(text);
  });

  console.log(`Total refund-related notifications: ${candidates.length}`);
  console.log(`Of those, AE-/ME- (cross-team): ${stale.length}\n`);

  if (stale.length === 0) {
    console.log("Nothing to clean — Izaan's bell is already free of cross-team refund noise.");
    return;
  }

  for (const n of stale.slice(0, 20)) {
    console.log(`  [${n.createdAt.toISOString()}] ${n.title} — ${n.message?.slice(0, 80)}`);
  }
  if (stale.length > 20) console.log(`  ...(+${stale.length - 20} more)`);

  const result = await prisma.notification.deleteMany({
    where: { id: { in: stale.map((n) => n.id) } },
  });
  console.log(`\nDeleted ${result.count} stale notification(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
