import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  addNiche,
  listNiches,
  NICHE_CAP_PER_USER,
  NICHE_MAX_LENGTH,
} from "@/lib/services/employee-niche.service";
import { getDailyTrendingAccess } from "@/lib/services/daily-trending-access";

/**
 * /api/employee-niches
 *
 * GET  → caller's own niches (oldest first)
 * POST → add a new niche (5-cap enforced server-side)
 *
 * Both gated behind `getDailyTrendingAccess.canUseRealTool` so HR /
 * Facebook accounts can't accidentally drive cron load.
 */

export const dynamic = "force-dynamic";

const PostSchema = z.object({
  niche: z.string().min(2).max(NICHE_MAX_LENGTH),
});

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getDailyTrendingAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) return error("Forbidden", 403);

  const niches = await listNiches(session.user.id);
  return json({ niches, cap: NICHE_CAP_PER_USER });
}

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getDailyTrendingAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) return error("Forbidden", 403);

  let payload: z.infer<typeof PostSchema>;
  try {
    payload = PostSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return error(
        err.issues
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join(" · "),
        400,
      );
    }
    return error(
      err instanceof Error ? err.message : "Invalid payload",
      400,
    );
  }

  try {
    const row = await addNiche(session.user.id, payload.niche);
    return json({ niche: row });
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "INVALID_LENGTH") {
      return error(`Niche must be at least 2 characters`, 400);
    }
    if (code === "CAP_REACHED") {
      return error(
        `You can have at most ${NICHE_CAP_PER_USER} niches. Remove one first.`,
        409,
      );
    }
    if (code === "DUPLICATE") {
      return error(`You already have that niche`, 409);
    }
    console.error("[employee-niches] add failed:", err);
    return error("Failed to add niche", 500);
  }
}
