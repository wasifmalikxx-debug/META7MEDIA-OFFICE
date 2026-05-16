import { json, error, requireAuth } from "@/lib/api-helpers";
import { deleteNiche } from "@/lib/services/employee-niche.service";
import { getDailyTrendingAccess } from "@/lib/services/daily-trending-access";

/**
 * DELETE /api/employee-niches/[id]
 *
 * Removes a niche the caller owns. Returns 404 if it doesn't exist OR
 * belongs to someone else (so we don't leak existence). The trending
 * page reads from this user's niches on next load — no cascade needed,
 * historical DailyTrendingProduct rows stay queryable for analytics.
 */

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getDailyTrendingAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) return error("Forbidden", 403);

  const { id } = await context.params;
  if (!id) return error("Niche id required", 400);

  const removed = await deleteNiche(session.user.id, id);
  if (!removed) return error("Niche not found", 404);
  return json({ ok: true });
}
