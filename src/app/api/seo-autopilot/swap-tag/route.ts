import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { suggestTagReplacements } from "@/lib/services/anthropic.service";
import { getTagDemandStats } from "@/lib/services/etsy-api.service";

/**
 * POST /api/seo-autopilot/swap-tag
 *
 * SUPER_ADMIN only.
 *
 * Take a tag the seller wants to replace + the surrounding product
 * context, and return 3 alternative tags with Etsy demand stats so the
 * seller can pick the best swap.
 *
 * Pipeline:
 *   1. Haiku writes 3 replacement candidates (~$0.001)
 *   2. Fetch live Etsy demand for each candidate in parallel (free)
 *   3. Return suggestions sorted by tier (niche first — that's the
 *      whole point of swapping, usually)
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  currentTag: z.string().min(1).max(40),
  productTitle: z.string().min(1).max(2000),
  productType: z.string().min(1).max(80),
  category: z.string().min(1).max(200),
  existingTags: z.array(z.string()).max(20).default([]),
  reason: z.string().max(120).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") {
    return error("Forbidden", 403);
  }

  let payload: z.infer<typeof RequestSchema>;
  try {
    const body = await request.json();
    payload = RequestSchema.parse(body);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // Stage 1 — Haiku brainstorms replacements
  let candidates;
  try {
    candidates = await suggestTagReplacements({
      currentTag: payload.currentTag,
      productTitle: payload.productTitle,
      productType: payload.productType,
      category: payload.category,
      existingTags: payload.existingTags,
      reason: payload.reason ?? undefined,
    });
  } catch (err) {
    return error(
      `Couldn't generate alternatives: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  if (candidates.length === 0) {
    return json({ suggestions: [] });
  }

  // Stage 2 — fetch live Etsy demand for each candidate (parallel).
  const enriched = await Promise.all(
    candidates.map(async (c) => {
      const stats = await getTagDemandStats(c.tag).catch(() => null);
      return {
        tag: c.tag,
        reason: c.reason,
        totalListings: stats?.totalListings ?? 0,
        avgTopFavorites: stats?.avgTopFavorites ?? 0,
        tier: stats?.tier ?? "niche",
        error: stats?.error,
      };
    }),
  );

  return json({ suggestions: enriched });
}
