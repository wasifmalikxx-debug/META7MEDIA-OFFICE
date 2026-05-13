import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { buildSnapshotsForMonth } from "@/lib/services/dashboard-snapshot.service";
import { nowPKT } from "@/lib/pkt";

export const dynamic = "force-dynamic";
// Sheet reads can take up to ~60s for the full Etsy roster on a cold
// cache. Bump well above the default function timeout so the call has
// room to finish even on slow API days.
export const maxDuration = 120;

/**
 * Manual "Refresh now" trigger for the CEO dashboard.
 *
 * Rebuilds DailyTeamSnapshot rows for the current PKT month by reading
 * every Etsy employee's sheet, aggregating per (date, team), and
 * upserting. Same code path the 9 AM cron uses — just on-demand.
 *
 * Auth:
 *  - SUPER_ADMIN / HR_ADMIN → allowed (they see the whole dashboard)
 *  - PARTNER                 → allowed (refresh their own team's numbers)
 *  - everyone else           → 403
 *
 * Latency: typically 20–40 seconds when sheets are warm. Returns
 * `{ ok: true, snapshot: { rowsUpserted, daysCovered, teamsCovered } }`.
 * The client then calls `router.refresh()` to re-render the dashboard
 * server-side, which pulls the fresh rows we just wrote.
 */
export async function POST(_request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  if (
    role !== "SUPER_ADMIN" &&
    role !== "HR_ADMIN" &&
    role !== "PARTNER"
  ) {
    return error("Forbidden", 403);
  }

  const pkt = nowPKT();
  const month = pkt.getUTCMonth() + 1;
  const year = pkt.getUTCFullYear();

  try {
    const result = await buildSnapshotsForMonth(month, year);
    return json({
      ok: true,
      month,
      year,
      snapshot: result,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[refresh-financials] failed:", err?.message);
    return error(err?.message || "Refresh failed", 500);
  }
}
