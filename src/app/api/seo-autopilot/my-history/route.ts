import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  getMyHistory,
  getMyHistoryEntry,
} from "@/lib/services/seo-autopilot-quota.service";

/**
 * GET /api/seo-autopilot/my-history
 *
 * Query params:
 *   - `scope=month` (default) → current PKT calendar month, newest
 *     first, capped at 30 entries. Used by the inline history section
 *     on /seo-autopilot.
 *   - `scope=all` → every generation the user has ever made, newest
 *     first, capped at 200. Used by /seo-autopilot/listings.
 *   - `id=<logId>` → returns just that one row (404 if it's not yours).
 *     Used by the Restore action — the page can rehydrate the result
 *     panel without firing the full pipeline again.
 *
 * Response shape for month/all:
 *   {
 *     windowLabel: "November 2026" | "All time",
 *     windowStartIso: ISO | null,
 *     windowEndIso:   ISO | null,
 *     entries: MyHistoryEntry[]
 *   }
 *
 * Response shape for ?id=<id>:
 *   { entry: MyHistoryEntry }
 *
 * Anyone authenticated can call this — they only ever see their own
 * rows (filtered by session.user.id in the service).
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const entry = await getMyHistoryEntry(session.user.id, id);
    if (!entry) return error("Not found", 404);
    return json({ entry });
  }

  const scope =
    url.searchParams.get("scope") === "all" ? "all" : "month";
  const data = await getMyHistory(session.user.id, { scope });
  return json(data);
}
