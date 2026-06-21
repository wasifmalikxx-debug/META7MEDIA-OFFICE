import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * M14 — race-safe fine creation.
 *
 * The Fine table has a unique constraint on (userId, date, type, reason). Every
 * auto-fine path already does a check-before-create, but that is a TOCTOU race:
 * two concurrent runs (e.g. a manual checkout firing alongside the cron) can both
 * pass the existence check and both insert, producing an identical duplicate fine
 * (confirmed once in prod — a 40ms double-insert).
 *
 * Drop-in replacement for `prisma.fine.create({ data })`: it performs the insert
 * and treats the unique-violation (P2002) as a benign no-op — if an identical
 * fine already exists, the duplicate is swallowed instead of throwing, so the
 * surrounding cron / checkout flow is never broken.
 *
 * Returns true if a new fine row was created, false if an identical one already
 * existed (the duplicate was prevented). Any non-P2002 error is re-thrown.
 */
export async function createFineDedup(args: Prisma.FineCreateArgs): Promise<boolean> {
  try {
    await prisma.fine.create(args);
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Identical fine (same user + date + type + reason) already exists.
      return false;
    }
    throw e;
  }
}
