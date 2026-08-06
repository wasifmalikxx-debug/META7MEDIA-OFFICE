import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  getUsage,
  getTeamStats,
} from "@/lib/services/seo-autopilot-quota.service";

/**
 * GET /api/seo-autopilot/usage
 *
 * Returns the current user's daily SEO Autopilot usage so the UI can
 * render the "X / 8 today" badge and disable Generate when at limit.
 *
 *   {
 *     count: 3,
 *     limit: 8,
 *     remaining: 5,
 *     resetAt: "2026-05-15T19:00:00.000Z",  // next PKT midnight in UTC
 *     isUnlimited: false,
 *     date: "2026-05-14"                     // PKT calendar date
 *   }
 *
 * Pass `?stats=true` as SUPER_ADMIN to also get per-user team stats for
 * the CEO usage panel:
 *
 *   {
 *     usage: { ... },
 *     stats: { today, limit, totalToday, totalYesterday, total7Day, entries }
 *   }
 *
 * CEO-only since Aug 6 2026 — non-CEO callers now get 403. (Before the
 * lock they received the usage block with `stats` omitted, no error.)
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const isCeo = session.user.role === "SUPER_ADMIN";
  // CEO-ONLY (Aug 6 2026): SEO Autopilot is locked to SUPER_ADMIN, and this
  // quota badge only ever served that UI (generator hero + the CEO-only
  // Autopilot Dashboard). Defense in depth alongside the page/API locks.
  if (!isCeo) return error("Forbidden", 403);

  const wantsStats = new URL(request.url).searchParams.get("stats") === "true";

  const usage = await getUsage({
    userId: session.user.id,
    isUnlimited: isCeo,
  });

  if (wantsStats && isCeo) {
    const stats = await getTeamStats();
    return json({ usage, stats });
  }

  return json({ usage });
}
