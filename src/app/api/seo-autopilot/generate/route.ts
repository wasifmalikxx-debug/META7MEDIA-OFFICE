import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  searchActiveListings,
  getNodeProperties,
  inferCategoryFromListings,
  searchTaxonomyNodes,
  getTaxonomyPath,
  getSellerTaxonomy,
  toCompetitorBriefs,
  analyzeKeywordFrequencies,
  evaluateKeywordCandidates,
  getTagDemandStatsBatch,
  type TagDemand,
  type AnchorKeywords,
  type BuyerKeywordScore,
} from "@/lib/services/etsy-api.service";
import {
  extractSearchContext,
  expandSearchVariants,
  checkProductCompliance,
  generateListing,
  validateListing,
  pickCategoryFromCandidates,
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
  // 1–2 product images (at least one is required — vision compliance
  // gate needs to see the product, and we generate alt text per image).
  images: z
    .array(ImageSchema)
    .min(1, "At least one product image is required.")
    .max(2),
  // Variations — every product has them, so these are required-ish (zero
  // length is allowed but the UI nudges the seller to fill at least one).
  // `variants` was renamed from `colors` — it covers any choice the buyer
  // makes (color, phone model, design, material, scent).
  sizes: z.array(z.string().min(1).max(50)).max(30).default([]),
  variants: z.array(z.string().min(1).max(50)).max(30).default([]),
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
    context = await extractSearchContext(payload.aliExpressTitle);
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

  // ─── Stage 2 — Sonnet vision compliance + Haiku buyer-keyword
  //                brainstorm (parallel — both independent) ─────────────

  let compliance: ComplianceVerdict;
  let buyerVariants: string[] = [];
  try {
    [compliance, buyerVariants] = await Promise.all([
      checkProductCompliance({
        title: payload.aliExpressTitle,
        images,
      }),
      // Best-effort — if the brainstorm fails we still proceed with just
      // the competitor-derived anchors.
      expandSearchVariants({
        seedKeyword: context.searchKeyword,
        productType: context.productType,
        audienceHint: context.audienceHint || undefined,
        styleHint: context.styleHint || undefined,
      }).catch(() => [] as string[]),
    ]);
  } catch (err) {
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
      anchorKeywords: { topPhrases: [], topTags: [], totalListings: 0 },
      buyerKeywords: [] as BuyerKeywordScore[],
      textCompliance: null,
      generatedAt: new Date().toISOString(),
    });
  }

  // ─── Stage 3 — Etsy research ───────────────────────────────────────

  let competitors;
  let category;
  let properties;
  let anchorKeywords: AnchorKeywords = {
    topPhrases: [],
    topTags: [],
    totalListings: 0,
  };
  // Buyer-language anchors — scored variants we'll feed into generation.
  // Populated in parallel with the rest of the research.
  let buyerKeywords: BuyerKeywordScore[] = [];
  try {
    // Search + (in parallel) score the buyer-language variants. Both run
    // against the Etsy API and share the token bucket; total wall time
    // ≈ max of the two, not sum.
    const [listings, scoredVariants] = await Promise.all([
      searchActiveListings(context.searchKeyword, 20),
      buyerVariants.length > 0
        ? evaluateKeywordCandidates(buyerVariants).catch(() => [])
        : Promise.resolve([] as BuyerKeywordScore[]),
    ]);
    competitors = toCompetitorBriefs(listings);
    anchorKeywords = analyzeKeywordFrequencies(listings, 10);
    // Keep the top 12 — Sonnet sees them in its prompt.
    buyerKeywords = scoredVariants.slice(0, 12);

    category = await inferCategoryFromListings(
      listings,
      context.productType,
      payload.aliExpressTitle,
    );

    // Last-resort: Haiku classifier. Build a candidate set from the top
    // ~30 fuzzy matches in the taxonomy + the level-1 root categories
    // (~30 too) so Haiku always has something to pick from. Only fires
    // when the heuristic cascade returned nothing.
    if (!category) {
      const candidateNodes = await searchTaxonomyNodes(
        `${context.productType} ${payload.aliExpressTitle}`,
        30,
      );
      const allNodes = await getSellerTaxonomy();
      const level1 = allNodes.filter((n) => n.level === 1).slice(0, 30);
      const candidatePool = [
        ...new Map(
          [...candidateNodes, ...level1].map((n) => [n.id, n]),
        ).values(),
      ];
      const candidates = await Promise.all(
        candidatePool.map(async (n) => ({
          id: n.id,
          name: n.name,
          path: await getTaxonomyPath(n.id),
        })),
      );

      const pickedId = await pickCategoryFromCandidates({
        title: payload.aliExpressTitle,
        productType: context.productType,
        candidates,
      });

      if (pickedId) {
        const node = allNodes.find((n) => n.id === pickedId);
        if (node) {
          category = {
            id: node.id,
            name: node.name,
            path: await getTaxonomyPath(node.id),
          };
        }
      }
    }

    if (!category) {
      return error(
        `Couldn't match this product to an Etsy category. Try a more descriptive source title (include words like "ring", "dress", "wallet", etc.).`,
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
      images,
      category: { id: category.id, name: category.name, path: category.path },
      competitors,
      anchorKeywords,
      buyerKeywords,
      attributeSchema,
      audience: context.audienceHint || undefined,
      style: context.styleHint || undefined,
      sizes: payload.sizes,
      variants: payload.variants,
    });
  } catch (err) {
    return error(
      `Claude generation error: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // ─── Stage 5 — Tag intelligence + text audit (parallel) ────────────
  //
  // Both calls are independent of each other and of the rest of the
  // pipeline at this point. Run them concurrently to cut wall time.

  let textCompliance;
  let tagIntelligence: TagDemand[] = [];
  try {
    const [text, tags] = await Promise.all([
      validateListing(listing).catch((err) => ({
        ok: true,
        issues: [
          {
            severity: "warn" as const,
            field: "system",
            message: `Text compliance scan skipped: ${err instanceof Error ? err.message : "unknown"}`,
          },
        ],
      })),
      getTagDemandStatsBatch(listing.tags).catch(() => []),
    ]);
    textCompliance = text;
    tagIntelligence = tags;
  } catch (err) {
    textCompliance = {
      ok: true,
      issues: [
        {
          severity: "warn" as const,
          field: "system",
          message: `Final checks skipped: ${err instanceof Error ? err.message : "unknown"}`,
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
    anchorKeywords,
    buyerKeywords,
    textCompliance,
    tagIntelligence,
    // Echo back the SEO-relevant inputs so the UI can show the
    // variations / personalization sections in the result.
    inputs: {
      sizes: payload.sizes,
      variants: payload.variants,
    },
    generatedAt: new Date().toISOString(),
  });
}
