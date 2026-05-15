import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { huntByNiche } from "@/lib/services/product-hunter.service";
import { getActiveTokenForUser } from "@/lib/services/aliexpress-api.service";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/seo-autopilot/hunt-by-niche
 *
 * The new Manual Hunting pipeline (May 16 2026 redesign).
 *
 * Input:
 *   - niche (required)             e.g. "boho jewelry"
 *   - style (optional pill)        e.g. "minimalist"
 *   - audience (optional pill)     e.g. "anniversary gift"
 *   - extraCategories (optional)   employee's shop categories to force-include
 *
 * Pipeline:
 *   1. Haiku → niche → 5-8 shop categories
 *   2. Per category (parallel) → Haiku → 4-6 keywords
 *   3. Per keyword (parallel) → Etsy demand + score
 *   4. Per GREAT/GOOD keyword → AliExpress top-3 preview + margin
 *
 * Returns the results organized by category.
 *
 * Access: CEO-only during pilot — same gate as the old hunt-products.
 * AE side uses the CEO's connected token.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60; // ~30s wall time at our rate limits

const RequestSchema = z.object({
  niche: z.string().min(2, "Niche must be at least 2 chars").max(80),
  style: z.string().max(40).optional().nullable(),
  audience: z.string().max(40).optional().nullable(),
  extraCategories: z.array(z.string().min(2).max(40)).max(10).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") {
    return error("Manual Hunting is in CEO-only pilot", 403);
  }

  let payload: z.infer<typeof RequestSchema>;
  try {
    payload = RequestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      const friendly = err.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join(" · ");
      return error(friendly, 400);
    }
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // CEO's AliExpress token powers the AE preview step.
  // If not connected, the pipeline still runs but skips AE previews —
  // employee sees a banner with reconnect instructions on the page itself.
  const ceoUser = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  const accessToken = ceoUser
    ? await getActiveTokenForUser(ceoUser.id)
    : null;

  try {
    const result = await huntByNiche({
      niche: payload.niche,
      style: payload.style ?? undefined,
      audience: payload.audience ?? undefined,
      extraCategories: payload.extraCategories,
      accessToken,
    });
    return json(result);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    console.error(`[hunt-by-niche] failed:`, reason);
    return error(`Hunt failed: ${reason}`, 502);
  }
}
