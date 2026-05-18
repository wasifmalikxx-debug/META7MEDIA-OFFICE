import { json, error, requireAuth } from "@/lib/api-helpers";
import { getProductHunterUsage } from "@/lib/services/product-hunter-quota.service";

/**
 * GET /api/seo-autopilot/hunt-usage
 *
 * Returns the current user's daily Product Hunter usage so the UI can
 * render the "X / 10 today" badge and disable the hunt button at limit.
 *
 *   {
 *     usage: {
 *       count: 3,
 *       limit: 10,
 *       remaining: 7,
 *       resetAt: "2026-05-19T19:00:00.000Z",  // next PKT midnight in UTC
 *       isUnlimited: false,
 *       date: "2026-05-18"                     // PKT calendar date
 *     }
 *   }
 *
 * CEO sees isUnlimited: true and a "remaining: Infinity" effectively
 * (rendered as the Crown "Unlimited" pill in the UI).
 *
 * Mirrors /api/seo-autopilot/usage but reads from ProductHunterUsage
 * instead of SeoAutopilotUsage. Kept as a separate endpoint so the two
 * quotas stay independent — using one tool doesn't burn slots in the
 * other.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const isCeo = session.user.role === "SUPER_ADMIN";

  const usage = await getProductHunterUsage({
    userId: session.user.id,
    isUnlimited: isCeo,
  });

  return json({ usage });
}
