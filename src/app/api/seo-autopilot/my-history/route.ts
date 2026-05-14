import { json, error, requireAuth } from "@/lib/api-helpers";
import { getMyHistory } from "@/lib/services/seo-autopilot-quota.service";

/**
 * GET /api/seo-autopilot/my-history
 *
 * Returns the current user's own Autopilot generations from the last
 * 30 days, newest first, capped at 30 entries. Each entry includes the
 * full listing snapshot so the UI can render an inline preview + a
 * "Restore" action that loads the listing back into the result panel
 * without burning a fresh quota slot.
 *
 * Anyone authenticated can call this endpoint — they only ever see
 * their own rows (filtered by session.user.id in the service).
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const entries = await getMyHistory(session.user.id, 30);
  return json({ entries });
}
