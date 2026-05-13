import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  searchActiveListings,
  getNodeProperties,
  getTaxonomyPath,
  toCompetitorBriefs,
} from "@/lib/services/etsy-api.service";
import {
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
 * Flow:
 *   1. Pull top 20 ranking listings from Etsy for the seed keyword
 *      (this is the live competitive-intelligence layer Claude uses).
 *   2. Pull the category's required + optional attribute schema.
 *   3. Build the resolved category path ("Jewelry > Earrings > ...").
 *   4. Ask Sonnet to write the listing JSON.
 *   5. Ask Haiku to compliance-audit the result.
 *   6. Return everything to the UI.
 *
 * No DB writes — generations are ephemeral. If we later add a history
 * panel, add a SeoAutopilotGeneration model and persist here.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestSchema = z.object({
  productBrief: z.string().min(8, "Brief is too short").max(2000),
  referenceTitle: z.string().max(500).optional().nullable(),
  category: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
  }),
  seedKeyword: z.string().min(2).max(140),
  audience: z.string().max(200).optional().nullable(),
  style: z.string().max(200).optional().nullable(),
  shopMaturity: z.enum(["matured", "new"]).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  if (session.user.role !== "SUPER_ADMIN") {
    // Hard gate. UI tier already redirects non-CEO away from the page; this
    // is the server-side backstop in case anyone bypasses the page render
    // (e.g. via raw POST).
    return error("Forbidden — SEO Autopilot is in private beta", 403);
  }

  let payload: z.infer<typeof RequestSchema>;
  try {
    const body = await request.json();
    payload = RequestSchema.parse(body);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // ─── Stage 1 — research (Etsy API) ──────────────────────────────────

  let competitors;
  let path: string;
  let properties;
  try {
    const [listings, categoryPath, props] = await Promise.all([
      searchActiveListings(payload.seedKeyword, 20),
      getTaxonomyPath(payload.category.id),
      getNodeProperties(payload.category.id).catch(() => []),
    ]);
    competitors = toCompetitorBriefs(listings);
    path = categoryPath || payload.category.name;
    properties = props;
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

  // ─── Stage 2 — generate (Claude Sonnet) ─────────────────────────────

  let listing;
  try {
    listing = await generateListing({
      productBrief: payload.productBrief,
      referenceTitle: payload.referenceTitle ?? undefined,
      category: {
        id: payload.category.id,
        name: payload.category.name,
        path,
      },
      competitors,
      attributeSchema,
      audience: payload.audience ?? undefined,
      style: payload.style ?? undefined,
      shopMaturity: payload.shopMaturity ?? "matured",
    });
  } catch (err) {
    return error(
      `Claude generation error: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // ─── Stage 3 — validate (Claude Haiku) ──────────────────────────────

  // Compliance is best-effort — if Haiku 500s we still ship the listing
  // with a generic "validation skipped" note rather than block the whole
  // generation.
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
      seedKeyword: payload.seedKeyword,
      categoryPath: path,
      competitorsAnalyzed: competitors.length,
      // Send a slim slice of competitors back to the UI so the CEO can
      // see who Claude was looking at.
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
