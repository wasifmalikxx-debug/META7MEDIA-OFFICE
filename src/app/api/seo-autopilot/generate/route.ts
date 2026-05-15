import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  searchActiveListings,
  inferCategoryFromListings,
  searchTaxonomyNodes,
  getTaxonomyPath,
  getSellerTaxonomy,
  toCompetitorBriefs,
  analyzeKeywordFrequencies,
  getTagDemandStatsBatch,
  type TagDemand,
  type AnchorKeywords,
} from "@/lib/services/etsy-api.service";
import {
  extractSearchContext,
  expandSearchVariants,
  checkProductCompliance,
  generateListing,
  pickCategoryFromCandidates,
  createCostAccumulator,
  type ImagePayload,
  type ComplianceVerdict,
} from "@/lib/services/anthropic.service";
import {
  checkAndConsume,
  logGeneration,
  pktDateAsUtcMidnight,
  QuotaExceededError,
  SEO_AUTOPILOT_DAILY_LIMIT,
} from "@/lib/services/seo-autopilot-quota.service";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";
import { prisma } from "@/lib/prisma";

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
  // Per-label cap raised 50 → 100 (May 16) — 50 was rejecting legit
  // descriptive sizes like "Free Size for Petite, Average, and Plus
  // figures" that some AliExpress listings ship with.
  sizes: z.array(z.string().min(1).max(100)).max(30).default([]),
  variants: z.array(z.string().min(1).max(100)).max(30).default([]),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  // ─── Role gate ──────────────────────────────────────────────────
  // CEO + Izaan + EM employees + Etsy partners (Awais, Mubeen).
  // Shared helper keeps this in lockstep with page.tsx and swap-tag.
  const u = session.user;
  const access = await getSeoAutopilotAccess({
    id: u.id,
    role: u.role,
    employeeId: u.employeeId ?? null,
  });
  const isCeo = access.isCeo;

  if (!access.canUseRealTool) {
    return error(
      "Forbidden — SEO Autopilot is not enabled for your account",
      403,
    );
  }

  // Payload first (cheap, no external work) — so bad input doesn't
  // burn a quota slot.
  let payload: z.infer<typeof RequestSchema>;
  try {
    const body = await request.json();
    payload = RequestSchema.parse(body);
  } catch (err) {
    // Zod errors dump as raw JSON which is incomprehensible to the
    // employee. Translate them to human messages.
    if (err instanceof z.ZodError) {
      const friendly = err.issues
        .map((issue) => {
          const field = issue.path.join(".") || "input";
          // Map common errors to plain English
          if (issue.code === "too_big") {
            const max = (issue as { maximum?: number }).maximum;
            return `${field} is too long (max ${max} characters). Trim the value and try again.`;
          }
          if (issue.code === "too_small") {
            return `${field} is too short or empty.`;
          }
          if (issue.code === "invalid_type") {
            return `${field} has the wrong type — expected ${issue.expected ?? "another type"}.`;
          }
          return `${field}: ${issue.message}`;
        })
        .join(" · ");
      return error(friendly || "Invalid input", 400);
    }
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // ─── Daily quota gate ───────────────────────────────────────────
  // CEO bypasses the cap. Everyone else gets SEO_AUTOPILOT_DAILY_LIMIT
  // generations per Pakistan calendar day. We reserve the slot BEFORE
  // the expensive work. On failure of the downstream pipeline we refund
  // the slot (see the `quotaConsumed` flag below) so transient API
  // failures don't cost the user a generation.
  try {
    await checkAndConsume({ userId: u.id, isUnlimited: isCeo });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return new Response(
        JSON.stringify({
          error: `Daily limit reached (${SEO_AUTOPILOT_DAILY_LIMIT} generations/day). Resets at midnight Pakistan time.`,
          quotaExceeded: true,
          limit: err.limit,
          resetAt: err.resetAt.toISOString(),
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    throw err;
  }
  // Tracks whether we still owe the user a refund (set false once the
  // generation reaches a state we consider "billable" — i.e. the user
  // got useful output back: listing or BLOCKED verdict).
  let refundOnFailure = true;
  const refundQuotaIfStillPending = async () => {
    if (!refundOnFailure || isCeo) return;
    refundOnFailure = false;
    try {
      await prisma.seoAutopilotUsage.update({
        where: { userId_date: { userId: u.id, date: pktDateAsUtcMidnight() } },
        data: { count: { decrement: 1 } },
      });
    } catch {
      // Best-effort — if refund fails the user just sees one fewer slot
      // today. Don't surface this as a user-facing error.
    }
  };

  const images: ImagePayload[] = payload.images;

  // Capture exact Anthropic cost across every API call in this request.
  // Each helper trackUsage()'s its msg.usage into this accumulator;
  // we log the total on the SeoAutopilotLog row at the end. Replaces
  // the previous verdict-based estimate ($0.04 flat) with real numbers.
  const costAccum = createCostAccumulator();

  // ─── Stage 1 — Haiku reads title ────────────────────────────────────

  let context;
  try {
    context = await extractSearchContext(payload.aliExpressTitle, costAccum);
  } catch (err) {
    await refundQuotaIfStillPending();
    return error(
      `Failed to read your title: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  if (!context.searchKeyword) {
    await refundQuotaIfStillPending();
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
      checkProductCompliance(
        {
          title: payload.aliExpressTitle,
          images,
        },
        costAccum,
      ),
      // Best-effort — if the brainstorm fails we still proceed with just
      // the competitor-derived anchors.
      expandSearchVariants(
        {
          seedKeyword: context.searchKeyword,
          productType: context.productType,
          audienceHint: context.audienceHint || undefined,
          styleHint: context.styleHint || undefined,
        },
        costAccum,
      ).catch(() => [] as string[]),
    ]);
  } catch (err) {
    await refundQuotaIfStillPending();
    return error(
      `Compliance check failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // BLOCKED → return early. Don't waste tokens generating a listing the
  // employee can't legally publish. The quota slot stays consumed —
  // compliance is a billable outcome (Haiku already did vision work).
  if (compliance.verdict === "BLOCKED") {
    refundOnFailure = false;
    await logGeneration({
      userId: u.id,
      sourceTitle: payload.aliExpressTitle,
      generatedTitle: null,
      verdict: "BLOCKED",
      category: null,
      actualCostUsd: costAccum.totalCostUsd,
      inputTokens: costAccum.totalInputTokens,
      outputTokens: costAccum.totalOutputTokens,
      cacheReadTokens: costAccum.totalCacheReadTokens,
      cacheWriteTokens: costAccum.totalCacheWriteTokens,
      // No listing on BLOCKED — user's history will show the source
      // title + the BLOCKED verdict but no listing detail to expand.
      listing: null,
      sizes: payload.sizes,
      variants: payload.variants,
    });
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
      },
      listing: null,
      anchorKeywords: { topPhrases: [], topTags: [], totalListings: 0 },
      generatedAt: new Date().toISOString(),
    });
  }

  // ─── Stage 3 — Etsy research ───────────────────────────────────────

  let competitors;
  let category;
  let anchorKeywords: AnchorKeywords = {
    topPhrases: [],
    topTags: [],
    totalListings: 0,
  };
  try {
    // Just the search — we used to ALSO fire 25× getTagDemandStats here
    // to score the buyer-search variants against live Etsy demand, but
    // that was 64% of our per-gen Etsy quota for marginal SEO gain. The
    // unscored Haiku brainstorm still flows into Sonnet's prompt as
    // alternative-angle inspiration.
    const listings = await searchActiveListings(context.searchKeyword, 20);
    competitors = toCompetitorBriefs(listings);
    anchorKeywords = analyzeKeywordFrequencies(listings, 10);

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

      const pickedId = await pickCategoryFromCandidates(
        {
          title: payload.aliExpressTitle,
          productType: context.productType,
          candidates,
        },
        costAccum,
      );

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
      await refundQuotaIfStillPending();
      return error(
        `Couldn't match this product to an Etsy category. Try a more descriptive source title (include words like "ring", "dress", "wallet", etc.).`,
        422,
      );
    }
  } catch (err) {
    await refundQuotaIfStillPending();
    return error(
      `Etsy API error during research: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // ─── Stage 4 — Sonnet writes the listing (with vision) ─────────────

  let listing;
  try {
    listing = await generateListing(
      {
        productBrief: payload.aliExpressTitle,
        images,
        category: { id: category.id, name: category.name, path: category.path },
        competitors,
        anchorKeywords,
        buyerVariants,
        audience: context.audienceHint || undefined,
        style: context.styleHint || undefined,
        sizes: payload.sizes,
        variants: payload.variants,
      },
      costAccum,
    );
  } catch (err) {
    await refundQuotaIfStillPending();
    return error(
      `Claude generation error: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // Listing successfully generated — the slot is now permanently
  // consumed. Anything that fails AFTER this point (tag intelligence)
  // is non-billable already (Etsy free + listing already returned).
  refundOnFailure = false;
  await logGeneration({
    userId: u.id,
    sourceTitle: payload.aliExpressTitle,
    generatedTitle: listing.title,
    verdict: compliance.verdict === "REVIEW" ? "REVIEW" : "ALLOWED",
    category: category.path,
    actualCostUsd: costAccum.totalCostUsd,
    inputTokens: costAccum.totalInputTokens,
    outputTokens: costAccum.totalOutputTokens,
    cacheReadTokens: costAccum.totalCacheReadTokens,
    cacheWriteTokens: costAccum.totalCacheWriteTokens,
    // Full listing snapshot for the user's 30-day history view
    listing: {
      title: listing.title,
      description: listing.description,
      tags: listing.tags,
      altTexts: listing.altTexts,
      rationale: listing.rationale,
      categoryPath: category.path,
      categoryId: category.id,
      searchKeyword: context.searchKeyword,
      productType: context.productType,
      audienceHint: context.audienceHint,
      styleHint: context.styleHint,
    },
    sizes: payload.sizes,
    variants: payload.variants,
  });

  // ─── Stage 5 — Tag intelligence ────────────────────────────────────
  //
  // The Haiku text audit was removed May 14: it produced stylistic
  // "consider rephrasing" advice rather than hard rule blockers, and
  // normalize() inside generateListing() already clamps every output
  // to Etsy's hard limits (140-char title, 13 tags ≤20 chars each,
  // 5000-char description, etc.).

  const tagIntelligence: TagDemand[] = await getTagDemandStatsBatch(
    listing.tags,
  ).catch(() => []);

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
    },
    anchorKeywords,
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
