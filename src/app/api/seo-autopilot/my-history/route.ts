import { json, error, requireAuth } from "@/lib/api-helpers";
import { getMyHistory } from "@/lib/services/seo-autopilot-quota.service";

/**
 * GET /api/seo-autopilot/my-history
 *
 * Returns the current user's own Autopilot generations from the CURRENT
 * Pakistan calendar month, newest first. List resets cleanly at PKT
 * midnight on the 1st. Each entry includes the full listing snapshot
 * so the UI can render an inline preview + a "Restore" action that
 * loads the listing back into the result panel without burning a fresh
 * quota slot.
 *
 * Response shape:
 *   {
 *     windowLabel: "November 2026",
 *     windowStartIso: "2026-10-31T19:00:00.000Z",  // PKT month start
 *     windowEndIso:   "2026-11-30T19:00:00.000Z",  // next PKT month start
 *     entries: MyHistoryEntry[]
 *   }
 *
 * Anyone authenticated can call this — they only ever see their own
 * rows (filtered by session.user.id in the service).
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const data = await getMyHistory(session.user.id);
  return json(data);
}
