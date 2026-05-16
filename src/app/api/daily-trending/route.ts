import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { listNiches } from "@/lib/services/employee-niche.service";
import {
  getTodaysTrendingGrouped,
  todayInPkt,
  type TrendingSource,
} from "@/lib/services/daily-trending.service";
import { getDailyTrendingAccess } from "@/lib/services/daily-trending-access";

/**
 * GET /api/daily-trending?source=TRENDING|FRESH
 *
 * Returns today's batch for the caller's niches, grouped by niche.
 * Reads from the DB only — no live AE calls — so the page loads
 * instantly and costs nothing per visit.
 *
 * Query params:
 *   source (optional, default TRENDING) — which feed to return.
 *     - TRENDING: high-volume best-sellers (orders >= 50)
 *     - FRESH:    early-momentum new listings (5-200 orders)
 *
 * Empty state: if the user has no niches yet, `niches` is [] and
 * `groups` is []. The UI shows the "Add your first niche" state.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getDailyTrendingAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) return error("Forbidden", 403);

  // Source query param — accept upper or lower case for forgiveness.
  // Any unknown value falls back to TRENDING.
  const raw = (
    request.nextUrl.searchParams.get("source") ?? ""
  ).toUpperCase();
  const source: TrendingSource = raw === "FRESH" ? "FRESH" : "TRENDING";

  const myNiches = await listNiches(session.user.id);
  const activeNicheStrings = myNiches
    .filter((n) => n.active)
    .map((n) => n.niche);

  const groups = await getTodaysTrendingGrouped(activeNicheStrings, source);
  const fetchDate = todayInPkt();

  return json({
    fetchDate: fetchDate.toISOString(),
    source,
    niches: myNiches,
    groups,
    isCeo: access.isCeo,
  });
}
