import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  suggestTagReplacements,
  createCostAccumulator,
} from "@/lib/services/anthropic.service";
import { getTagDemandStats } from "@/lib/services/etsy-api.service";
import { logTagSwap } from "@/lib/services/seo-autopilot-quota.service";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

/**
 * POST /api/seo-autopilot/swap-tag
 *
 * Whoever can use the main SEO Autopilot tool (CEO + Izaan + EM team
 * during the test phase) can also call this endpoint to get 3 tag
 * replacement suggestions for an existing tag.
 *
 * Pipeline:
 *   1. Haiku writes 3 replacement candidates (~$0.0014, tracked via
 *      the cost accumulator and logged to SeoAutopilotTagSwapLog so
 *      it shows up in the CEO dashboard totals)
 *   2. Fetch live Etsy demand for each candidate in parallel (free)
 *   3. Return suggestions sorted by tier (niche first — that's the
 *      whole point of swapping, usually)
 *
 * No quota cap applied — tag swaps are cheap ($0.0014/call vs ~$0.04
 * for a full gen) and rate-limiting them adds friction without
 * meaningful cost protection.
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

  // ─── Role gate — mirrors /api/seo-autopilot/generate ──────────────
  const u = session.user;
  const access = await getSeoAutopilotAccess({
    id: u.id,
    role: u.role,
    employeeId: u.employeeId ?? null,
  });

  if (!access.canUseRealTool) {
    return error(
      "Forbidden — SEO Autopilot is not enabled for your account",
      403,
    );
  }

  let payload: z.infer<typeof RequestSchema>;
  try {
    const body = await request.json();
    payload = RequestSchema.parse(body);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // Track Anthropic cost on this swap call so the CEO dashboard's
  // total Anthropic spend reflects swap cost in addition to gen cost.
  const costAccum = createCostAccumulator();

  // Stage 1 — Haiku brainstorms replacements
  let candidates;
  try {
    candidates = await suggestTagReplacements(
      {
        currentTag: payload.currentTag,
        productTitle: payload.productTitle,
        productType: payload.productType,
        category: payload.category,
        existingTags: payload.existingTags,
        reason: payload.reason ?? undefined,
      },
      costAccum,
    );
  } catch (err) {
    return error(
      `Couldn't generate alternatives: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // Log the swap-suggestion call with the actual Haiku cost. Even if
  // the user picks zero of the candidates, we still paid Anthropic for
  // this call — so it gets attributed to them in the audit.
  await logTagSwap({
    userId: u.id,
    currentTag: payload.currentTag,
    suggestedTags: candidates.map((c) => c.tag),
    reason: payload.reason ?? null,
    actualCostUsd: costAccum.totalCostUsd,
    inputTokens: costAccum.totalInputTokens,
    outputTokens: costAccum.totalOutputTokens,
    cacheReadTokens: costAccum.totalCacheReadTokens,
    cacheWriteTokens: costAccum.totalCacheWriteTokens,
  });

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

  // Stage 3 — drop dead-tag suggestions (under 30 Etsy listings = no
  // buyer demand exists for this phrase). The CEO flagged getting
  // suggestions like "wooden wall key stor" with 1 listing — those
  // are useless. We keep niche tags (30-1k listings) since those are
  // exactly what we want sellers to use, just not the truly dead ones.
  //
  // If filtering would leave us with zero suggestions, return what we
  // have anyway so the seller sees SOMETHING (better than empty).
  const MIN_LISTINGS = 30;
  const alive = enriched.filter((s) => s.totalListings >= MIN_LISTINGS);
  const finalSuggestions = alive.length > 0 ? alive : enriched;

  return json({ suggestions: finalSuggestions });
}
