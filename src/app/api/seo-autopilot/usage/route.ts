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
 * Non-CEO callers asking for stats get only the usage block (the
 * `stats` field is omitted, no error).
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const isCeo = session.user.role === "SUPER_ADMIN";
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
