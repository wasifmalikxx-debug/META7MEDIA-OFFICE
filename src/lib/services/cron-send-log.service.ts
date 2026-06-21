import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * L8/L18 — idempotency guard for cron WhatsApp/report sends.
 *
 * Claims `key` by inserting a CronSendLog row BEFORE the send:
 *   - returns true  → caller should SEND (slot freshly claimed)
 *   - returns false → caller should SKIP (an identical send already happened today)
 *
 * ONLY a P2002 unique-collision means "already sent". Any OTHER error (DB blip,
 * or the table not existing yet pre-migration) FALLS THROUGH to send (returns
 * true) — we must never suppress a legitimate first send because of a marker
 * failure. Vercel Cron does not auto-retry, so the real double-send vector is a
 * human re-triggering the cron URL; claiming the slot first makes that re-run
 * see P2002 and no-op.
 */
export async function claimCronSend(key: string): Promise<boolean> {
  try {
    await prisma.cronSendLog.create({ data: { key } });
    return true; // claimed → proceed to send
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return false; // identical send already recorded today → skip
    }
    return true; // any other error → fail-safe: still send
  }
}

/**
 * Releases a previously-claimed key (deletes the marker) so a FAILED send can be
 * retried on a later run — "failed sends stay retryable, confirmed sends are not
 * re-sent". Best-effort; never throws.
 */
export async function releaseCronSend(key: string): Promise<void> {
  try {
    await prisma.cronSendLog.delete({ where: { key } });
  } catch {
    // marker may not exist / transient DB error — not worth failing the cron
  }
}
