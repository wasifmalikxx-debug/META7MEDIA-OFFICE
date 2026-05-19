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

  // Stage 3 — quality filters before sending back to the seller.
  //
  // 1) Drop DEAD tags (< MIN_LISTINGS). The CEO flagged getting score-1
  //    or score-2 suggestions like "wooden wall key stor" — useless. The
  //    threshold is the floor where a tag has enough search volume to
  //    be worth a slot. Bumped from 30 → 200 May 19 2026 after the CEO
  //    saw multiple score-1/2 suggestions in production. Niche tags
  //    (200-1k listings) still pass — those are the easy-win slots.
  // 2) Drop SATURATED tags (>50k) when the seller swapped specifically
  //    because the current tag was too hot. We detect this via the
  //    optional `reason` field. If they didn't give a reason, leave
  //    saturated picks in — they might genuinely want a high-traffic
  //    anchor.
  //
  // If filtering would leave us with zero suggestions, fall back to
  // whatever survived the dead-tag filter so the seller sees SOMETHING.
  const MIN_LISTINGS = 200;
  const SATURATED_THRESHOLD = 50_000;
  const reason = (payload.reason ?? "").toLowerCase();
  const swappingForSaturation =
    reason.includes("saturat") ||
    reason.includes("too hot") ||
    reason.includes("hard to rank") ||
    reason.includes("competitive");

  const alive = enriched.filter((s) => s.totalListings >= MIN_LISTINGS);
  const filtered = swappingForSaturation
    ? alive.filter((s) => s.totalListings < SATURATED_THRESHOLD)
    : alive;

  // Sort by tier: niche first (easy wins), then moderate, then hot —
  // skip saturated at the end. Within a tier, higher avgFavorites wins
  // (proxy for "demand × engagement").
  const tierRank: Record<string, number> = {
    niche: 0,
    moderate: 1,
    hot: 2,
    saturated: 3,
  };
  const sorted = [...filtered].sort((a, b) => {
    const aTier = tierRank[a.tier] ?? 99;
    const bTier = tierRank[b.tier] ?? 99;
    if (aTier !== bTier) return aTier - bTier;
    return (b.avgTopFavorites ?? 0) - (a.avgTopFavorites ?? 0);
  });

  const finalSuggestions = sorted.length > 0
    ? sorted.slice(0, 5)
    : alive.length > 0
      ? alive.slice(0, 5)
      : enriched.slice(0, 5); // last-resort fallback so UI never empties

  return json({ suggestions: finalSuggestions });
}
