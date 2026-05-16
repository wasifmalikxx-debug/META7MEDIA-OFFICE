import { json, error, requireAuth } from "@/lib/api-helpers";
import { listNiches } from "@/lib/services/employee-niche.service";
import {
  getTodaysTrendingGrouped,
  todayInPkt,
} from "@/lib/services/daily-trending.service";
import { getDailyTrendingAccess } from "@/lib/services/daily-trending-access";

/**
 * GET /api/daily-trending
 *
 * Returns today's batch of trending products for the caller's niches,
 * grouped by niche. Reads from the DB only — no live AE calls — so the
 * page loads instantly and costs nothing per visit.
 *
 * Empty state: if the user has no niches yet, `niches` is [] and
 * `groups` is []. The UI shows the "Add your first niche" empty state.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getDailyTrendingAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) return error("Forbidden", 403);

  const myNiches = await listNiches(session.user.id);
  const activeNicheStrings = myNiches
    .filter((n) => n.active)
    .map((n) => n.niche);

  const groups = await getTodaysTrendingGrouped(activeNicheStrings);
  const fetchDate = todayInPkt();

  return json({
    fetchDate: fetchDate.toISOString(),
    niches: myNiches,
    groups,
    isCeo: access.isCeo,
  });
}
