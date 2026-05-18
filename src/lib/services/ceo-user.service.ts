/**
 * CEO user lookup — single source of truth.
 *
 * Several routes need to find "the CEO" to borrow the AliExpress token
 * (CEO owns the AE OAuth connection; everyone else proxies through it).
 * The naive pattern is `prisma.user.findFirst({ where: { role: SUPER_ADMIN } })`,
 * which works today because there's only one SUPER_ADMIN — but with
 * multi-office in prod, a second admin could be inserted later and
 * findFirst would silently pick whoever happened to be first in row order.
 *
 * This helper centralises the lookup. Pin behaviour by `CEO_EMAIL` env
 * var if set; otherwise fall back to `findFirst(SUPER_ADMIN)` so older
 * environments without the env var keep working.
 */

import { prisma } from "@/lib/prisma";

export interface CeoUserRef {
  id: string;
}

/**
 * Returns the canonical CEO user row, or null if no SUPER_ADMIN
 * exists. Use the email pin (CEO_EMAIL env) when present so a second
 * admin in the DB doesn't accidentally hijack the AE token slot.
 */
export async function findCeoUser(): Promise<CeoUserRef | null> {
  const pinnedEmail = process.env.CEO_EMAIL?.trim().toLowerCase();
  if (pinnedEmail) {
    const pinned = await prisma.user.findFirst({
      where: {
        role: "SUPER_ADMIN",
        email: { equals: pinnedEmail, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (pinned) return pinned;
    // Pinned email didn't match anyone — log and fall through to the
    // generic SUPER_ADMIN lookup so the app doesn't fail just because
    // the env var got out of sync.
    console.warn(
      `[ceo-user] CEO_EMAIL is set to "${pinnedEmail}" but no SUPER_ADMIN matched; falling back to findFirst`,
    );
  }
  return prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
    orderBy: { createdAt: "asc" }, // deterministic — oldest SUPER_ADMIN wins
  });
}
