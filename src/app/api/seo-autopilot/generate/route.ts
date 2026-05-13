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
  checkProductCompliance,
  generateListing,
  validateListing,
  type ImagePayload,
  type ComplianceVerdict,
} from "@/lib/services/anthropic.service";

/**
 * POST /api/seo-autopilot/generate
 *
 * SUPER_ADMIN only.
 *
 * The complete SaaS pipeline:
 *   1. Haiku extracts search context from the title (keyword, type, hints)
 *   2. Sonnet VISION compliance gate — strict pass/fail on the product
 *      itself. If BLOCKED, we return early with no listing generated.
 *   3. Etsy: top 20 ranking listings + infer category from rankings +
 *      fetch attribute schema for that category.
 *   4. Sonnet VISION writes the full listing (title, tags, description,
 *      materials, all category attributes, alt text per image,
 *      personalization instructions, suggested type/who/when/what).
 *   5. Haiku audits the text for length/banned-word issues.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 90; // Sonnet vision can take 20-40s

const ImageSchema = z.object({
  base64: z.string().min(100), // any reasonable base64 image is way bigger
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

const RequestSchema = z.object({
  // Required source
  aliExpressTitle: z.string().min(8, "Need at least 8 characters").max(2000),
  notes: z.string().max(1000).optional().nullable(),
  // Up to 2 product images
  images: z.array(ImageSchema).max(2).default([]),
  // Optional variations
  sizes: z.array(z.string().min(1).max(50)).max(30).default([]),
  colors: z.array(z.string().min(1).max(50)).max(30).default([]),
  hasPersonalization: z.boolean().default(false),
  personalizationOptions: z.string().max(500).optional().nullable(),
  // Optional pricing & inventory (employee fills directly on Etsy, but
  // we accept them for future use / display)
  price: z.number().nonnegative().optional().nullable(),
  quantity: z.number().int().nonnegative().optional().nullable(),
  sku: z.string().max(60).optional().nullable(),
  // Optional production / delivery
  whoMadeIt: z.enum(["i_did", "someone_else", "collective"]).optional().nullable(),
  whatIsIt: z.enum(["finished_product", "supply"]).optional().nullable(),
  whenMade: z.string().max(60).optional().nullable(),
  processingDays: z.string().max(60).optional().nullable(),
  returnsPolicy: z.string().max(120).optional().nullable(),
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

  const images: ImagePayload[] = payload.images;

  // ─── Stage 1 — Haiku reads title ────────────────────────────────────

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

  // ─── Stage 2 — Sonnet vision compliance gate ───────────────────────

  let compliance: ComplianceVerdict;
  // If no images are provided, compliance is text-only (less powerful).
  // We still run it so we catch obvious trademark words in the title.
  try {
    compliance = await checkProductCompliance({
      title: payload.aliExpressTitle,
      notes: payload.notes ?? undefined,
      images,
    });
  } catch (err) {
    // If compliance check fails, don't proceed — better safe than sorry.
    return error(
      `Compliance check failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // BLOCKED → return early. Don't waste tokens generating a listing the
  // employee can't legally publish.
  if (compliance.verdict === "BLOCKED") {
    return json({
      compliance,
      // Echo what we read so the UI can still show "Autopilot's read"
      research: {
        searchKeyword: context.searchKeyword,
        productType: context.productType,
        audienceHint: context.audienceHint,
        styleHint: context.styleHint,
        categoryPath: "",
        categoryId: 0,
        competitorsAnalyzed: 0,
        topCompetitors: [],
        attributesAvailable: 0,
      },
      listing: null,
      textCompliance: null,
      generatedAt: new Date().toISOString(),
    });
  }

  // ─── Stage 3 — Etsy research ───────────────────────────────────────

  let competitors;
  let category;
  let properties;
  try {
    const listings = await searchActiveListings(context.searchKeyword, 20);
    competitors = toCompetitorBriefs(listings);

    category = await inferCategoryFromListings(listings, context.productType);
    if (!category) {
      return error(
        `Couldn't infer an Etsy category from ranking listings for "${context.searchKeyword}". Try a more descriptive source title.`,
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

  const attributeSchema = properties.map((p) => ({
    name: p.name,
    displayName: p.display_name || p.name,
    required: Boolean(p.is_required),
    possibleValues: (p.possible_values ?? []).map((v) => v.name).filter(Boolean),
  }));

  // ─── Stage 4 — Sonnet writes the listing (with vision) ─────────────

  let listing;
  try {
    listing = await generateListing({
      productBrief: payload.aliExpressTitle,
      notes: payload.notes ?? undefined,
      images,
      category: { id: category.id, name: category.name, path: category.path },
      competitors,
      attributeSchema,
      audience: context.audienceHint || undefined,
      style: context.styleHint || undefined,
      sizes: payload.sizes,
      colors: payload.colors,
      hasPersonalization: payload.hasPersonalization,
      personalizationOptions: payload.personalizationOptions ?? undefined,
    });
  } catch (err) {
    return error(
      `Claude generation error: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // Honour employee-provided suggestions when they came in.
  if (payload.whoMadeIt) listing.suggestedWhoMadeIt = payload.whoMadeIt;
  if (payload.whatIsIt) listing.suggestedWhatIsIt = payload.whatIsIt;
  if (payload.whenMade && payload.whenMade.trim().length > 0) {
    listing.suggestedWhenMade = payload.whenMade.trim();
  }

  // ─── Stage 5 — Haiku audits the text ───────────────────────────────

  let textCompliance;
  try {
    textCompliance = await validateListing(listing);
  } catch (err) {
    textCompliance = {
      ok: true,
      issues: [
        {
          severity: "warn" as const,
          field: "system",
          message: `Text compliance scan skipped: ${err instanceof Error ? err.message : "unknown"}`,
        },
      ],
    };
  }

  return json({
    compliance,
    listing,
    research: {
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
    textCompliance,
    // Echo back what the employee provided so the UI can show "your inputs"
    // alongside the AI output.
    inputs: {
      sizes: payload.sizes,
      colors: payload.colors,
      hasPersonalization: payload.hasPersonalization,
      personalizationOptions: payload.personalizationOptions ?? "",
      price: payload.price ?? null,
      quantity: payload.quantity ?? null,
      sku: payload.sku ?? "",
      processingDays: payload.processingDays ?? "",
      returnsPolicy: payload.returnsPolicy ?? "",
    },
    generatedAt: new Date().toISOString(),
  });
}
