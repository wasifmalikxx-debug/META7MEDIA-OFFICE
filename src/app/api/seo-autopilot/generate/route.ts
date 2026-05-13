import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  searchActiveListings,
  getNodeProperties,
  inferCategoryFromListings,
  toCompetitorBriefs,
} from "@/lib/services/etsy-api.service";
import {
  extractSearchContext,
  generateListing,
  validateListing,
} from "@/lib/services/anthropic.service";

/**
 * POST /api/seo-autopilot/generate
 *
 * SUPER_ADMIN only — the SaaS view is gated to the CEO (Wasif). Everyone
 * else hitting this route gets 403 even if they navigate directly. The
 * sidebar/page layer also shows "Coming Soon" to non-CEO users.
 *
 * One-input UX: the user pastes an AliExpress title (or any product
 * description). The pipeline figures everything else out.
 *
 * Pipeline:
 *   1. Haiku extracts {searchKeyword, productType, audienceHint,
 *      styleHint} from the title.
 *   2. Etsy: search top 20 active listings for the keyword.
 *   3. Infer target category from the dominant taxonomy_id among the
 *      top ranking listings (with a name-search fallback).
 *   4. Etsy: fetch required + optional attributes for that category.
 *   5. Sonnet writes the listing (title, tags, description, materials,
 *      attributes, alt text).
 *   6. Haiku audits compliance + local rule re-validation.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestSchema = z.object({
  /** AliExpress title or any product description. ≥8 chars. */
  aliExpressTitle: z.string().min(8, "Need at least 8 characters").max(2000),
  /** Optional extra notes — sizes, materials, audience, anything to highlight. */
  notes: z.string().max(1000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  if (session.user.role !== "SUPER_ADMIN") {
    return error("Forbidden — SEO Autopilot is in private beta", 403);
  }

  let payload: z.infer<typeof RequestSchema>;
  try {
    const body = await request.json();
    payload = RequestSchema.parse(body);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // ─── Stage 1 — Haiku extracts search context ────────────────────────

  let context;
  try {
    context = await extractSearchContext(
      payload.aliExpressTitle,
      payload.notes ?? undefined,
    );
  } catch (err) {
    return error(
      `Failed to read your title: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  if (!context.searchKeyword) {
    return error(
      "Couldn't extract a search keyword from that title. Try a more descriptive one.",
      400,
    );
  }

  // ─── Stage 2 — Etsy research (parallel) ─────────────────────────────

  let competitors;
  let category;
  let properties;
  try {
    const listings = await searchActiveListings(context.searchKeyword, 20);
    competitors = toCompetitorBriefs(listings);

    // Infer the target category from the top-ranking listings.
    category = await inferCategoryFromListings(listings, context.productType);
    if (!category) {
      return error(
        `Couldn't infer an Etsy category from ranking listings for "${context.searchKeyword}". Try adjusting the source title.`,
        422,
      );
    }

    properties = await getNodeProperties(category.id).catch(() => []);
  } catch (err) {
    return error(
      `Etsy API error during research: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // Flatten property schema for the prompt.
  const attributeSchema = properties.map((p) => ({
    name: p.name,
    displayName: p.display_name || p.name,
    required: Boolean(p.is_required),
    possibleValues: (p.possible_values ?? []).map((v) => v.name).filter(Boolean),
  }));

  // ─── Stage 3 — Sonnet writes the listing ────────────────────────────

  let listing;
  try {
    listing = await generateListing({
      productBrief: payload.aliExpressTitle,
      referenceTitle: payload.aliExpressTitle,
      category: {
        id: category.id,
        name: category.name,
        path: category.path,
      },
      competitors,
      attributeSchema,
      audience: context.audienceHint || undefined,
      style: context.styleHint || undefined,
      shopMaturity: "matured",
    });
  } catch (err) {
    return error(
      `Claude generation error: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // ─── Stage 4 — Haiku audits compliance ──────────────────────────────

  let compliance;
  try {
    compliance = await validateListing(listing);
  } catch (err) {
    compliance = {
      ok: true,
      issues: [
        {
          severity: "warn" as const,
          field: "system" as const,
          message: `Compliance scan skipped: ${err instanceof Error ? err.message : "unknown"}`,
        },
      ],
    };
  }

  return json({
    listing,
    compliance,
    research: {
      // What Autopilot decided — show this to the user so they can see
      // its reasoning at a glance.
      searchKeyword: context.searchKeyword,
      productType: context.productType,
      audienceHint: context.audienceHint,
      styleHint: context.styleHint,
      categoryPath: category.path,
      categoryId: category.id,
      competitorsAnalyzed: competitors.length,
      topCompetitors: competitors.slice(0, 5).map((c) => ({
        rank: c.rank,
        title: c.title,
        favorites: c.favorites,
      })),
      attributesAvailable: attributeSchema.length,
    },
    generatedAt: new Date().toISOString(),
  });
}
