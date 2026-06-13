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
  getTagDemandStats,
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
  suggestTagReplacements,
  enforceTagUniqueness,
  tagCanonical,
  scoreDescription,
  regenerateDescription,
  regenerateTags,
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
import {
  evaluatePolicyRules,
  rollupVerdict,
} from "@/lib/services/etsy-policy-rules";
import {
  reframeForEtsy,
  type ReframeResult,
} from "@/lib/services/product-validator-reframe.service";

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

// ─── Avoid-word scrub helpers (reframe / IP last-line-of-defense) ────
// Stage 4.5 scrubs the INITIAL generation. The Stage 4.6 QC gate and the
// saturated-tag swap can REGENERATE the description / tags afterwards, so
// these let us re-apply the same deterministic strip to the FINAL output —
// a reframed listing can never ship a banned avoid-word that a rewrite or
// swap re-introduced. Mirrors the regex used inline in Stage 4.5.
function buildAvoidRegexes(words: string[]): RegExp[] {
  return words.map(
    (w) =>
      new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
  );
}
function stripAvoidFromText(text: string, res: RegExp[]): string {
  let out = text;
  for (const re of res) {
    re.lastIndex = 0;
    out = out.replace(re, "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}
function dropAvoidTags(tags: string[], res: RegExp[]): string[] {
  return tags.filter(
    (t) =>
      !res.some((re) => {
        re.lastIndex = 0;
        return re.test(t);
      }),
  );
}

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
  // Per-label cap raised 100 → 250 (May 16, second pass) — 100 was
  // rejecting full-dimension size strings like "Length 120cm, Width
  // 80cm, Height 45cm, Diameter 22cm, Inside cavity depth 35cm" that
  // some AliExpress products ship with. 250 fits any reasonable
  // dimension write-up + leaves room for material/finish qualifiers.
  sizes: z.array(z.string().min(1).max(250)).max(30).default([]),
  variants: z.array(z.string().min(1).max(250)).max(30).default([]),
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

  // ─── Stage 1.5 — Policy rule engine (free, instant) ────────────────
  //
  // Same rule engine the Product Validator uses. Two roles:
  //   1. HARD-BLOCK early-return — if the title hits a true category
  //      ban (firearms, drugs, hate, adult, PPE, animals, violence),
  //      stop right here. Saves the Sonnet vision call entirely and
  //      doesn't burn a quota slot. Same products the validator's
  //      BLOCKED verdict refuses.
  //   2. SOFT-FLAG marker — if the title hits IP / brand / commodity
  //      / personalisation rules, mark the gen for reframe-aware
  //      generation (continues to vision compliance + reframe call
  //      + Sonnet with reframe constraints threaded in).
  const ruleHits = evaluatePolicyRules(payload.aliExpressTitle);
  const ruleVerdict = rollupVerdict(ruleHits);

  if (ruleVerdict === "BLOCKED") {
    // Hard-banned category. Halt before any Sonnet/Haiku cost.
    refundOnFailure = false;
    const topHit = ruleHits[0];
    const synthCompliance: ComplianceVerdict = {
      verdict: "BLOCKED",
      concerns: ruleHits.map((h) => ({
        severity: "block" as const,
        category: (h.rule.policy === "ip"
          ? "trademark"
          : h.rule.policy === "weapons" ||
              h.rule.policy === "drugs" ||
              h.rule.policy === "ppe" ||
              h.rule.policy === "animals" ||
              h.rule.policy === "hate" ||
              h.rule.policy === "adult" ||
              h.rule.policy === "violence"
            ? "prohibited"
            : "policy") as
          | "trademark"
          | "prohibited"
          | "counterfeit"
          | "policy"
          | "quality",
        details: `${h.rule.label} — matched "${h.matchedText}" (${h.rule.policyClause}). ${h.rule.explanation}`,
      })),
      summary: topHit
        ? `Cannot be listed: ${topHit.rule.label} — matched "${topHit.matchedText}" against ${topHit.rule.policyClause}. This is a category ban; no reframing will save it.`
        : "Cannot be listed — this product is in an Etsy-banned category.",
    };

    await logGeneration({
      userId: u.id,
      sourceTitle: payload.aliExpressTitle,
      generatedTitle: null,
      verdict: "BLOCKED",
      category: null,
      actualCostUsd: costAccum.totalCostUsd, // $0 — rule engine ran free
      inputTokens: costAccum.totalInputTokens,
      outputTokens: costAccum.totalOutputTokens,
      cacheReadTokens: costAccum.totalCacheReadTokens,
      cacheWriteTokens: costAccum.totalCacheWriteTokens,
      listing: null,
      sizes: payload.sizes,
      variants: payload.variants,
    });

    return json({
      compliance: synthCompliance,
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
      reframed: false,
      generatedAt: new Date().toISOString(),
    });
  }

  // Soft-flagged products fall through and continue. We capture the
  // hits so the reframe call (after vision compliance) can use them
  // for context.
  const softFlaggedByRules = ruleVerdict === "REVIEW";

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

  // Vision compliance is now a SOFT-FLAG signal, not a hard gate.
  // The rule engine above already hard-blocked the truly banned
  // categories (firearms, drugs, hate, adult, PPE, animals). If
  // vision says BLOCKED at this point, it caught something visual
  // the title-rule missed — almost always IP / brand visible in the
  // photo but not in the title (Marvel logo on a generically-titled
  // costume). For these we REFRAME instead of refusing: the team
  // can list the product with safer wording + the photo regen pass
  // strips the visible IP.
  const visionFlagged =
    compliance.verdict === "BLOCKED" || compliance.verdict === "REVIEW";
  const needsReframe = softFlaggedByRules || visionFlagged;

  // ─── Stage 2.5 — Reframe call (when soft-flagged) ─────────────────
  //
  // Same Haiku reframe service the Product Validator uses. Produces
  // the avoid-words list + listing approach + title/tag/description
  // guidance bullets + photo regen guidance. We thread these into
  // Sonnet's user prompt below as hard constraints so the generated
  // listing is Etsy-safe by construction.
  //
  // Non-fatal — if the reframe Haiku call fails, generation continues
  // without constraints (still better than refusing the product).
  let reframe: ReframeResult | null = null;
  if (needsReframe) {
    try {
      reframe = await reframeForEtsy({
        title: payload.aliExpressTitle,
        flags: ruleHits.map((h) => ({
          severity: h.rule.severity,
          policy: h.rule.policy,
          policyClause: h.rule.policyClause,
          label: h.rule.label,
          matchedText: h.matchedText,
          explanation: h.rule.explanation,
          suggestion: h.rule.suggestion,
        })),
        // SEO Autopilot user uploaded base64 images; reframe service
        // accepts them in the same shape as the Product Validator's
        // Manual check (base64 + mediaType per image).
        manualImages: images.map((img) => ({
          base64: img.base64,
          mediaType: img.mediaType,
        })),
      });
      // Roll the reframe Haiku's cost into the per-gen total so the
      // CEO footer reflects real spend.
      costAccum.totalCostUsd += reframe.costUsd;
    } catch (err) {
      console.warn(
        "[seo-autopilot] reframe failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }
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

  // ─── Stage 3.5 — Demand-annotate anchor keywords ───────────────────
  //
  // CEO directive May 20 2026: bring real Etsy demand data into the
  // Sonnet prompt so it can avoid saturated tags at GEN time, not
  // just measure them post-hoc.
  //
  // Without this, Sonnet was producing 12/13 saturated tags on mature
  // categories (leather bag = 599k listings, crossbody bag = 309k,
  // gift for her = 9.5M). Its training-data heuristic for "common
  // product tag" doesn't match Etsy's current listing density.
  //
  // We pre-score the top-10 anchor PHRASES and top-10 anchor TAGS
  // against live demand (~20 Etsy calls) and annotate each with its
  // tier so the prompt renders ✗ SATURATED / ⚠ HOT / ✓ MODERATE /
  // ★ NICHE next to it. Sonnet now SEES the saturation and steers
  // around it (per the rule we add to the prompt).
  //
  // Etsy quota math: previous 14 calls/gen + 20 here = 34/gen. With
  // ~25 gens/day at EM rollout that's 850 calls/day, well under the
  // 5K daily cap.
  try {
    const phraseTerms = anchorKeywords.topPhrases.slice(0, 10).map((p) => p.phrase);
    const tagTerms = anchorKeywords.topTags.slice(0, 10).map((t) => t.phrase);
    const allTerms = [...phraseTerms, ...tagTerms];

    if (allTerms.length > 0) {
      const demand = await getTagDemandStatsBatch(allTerms);
      const byTerm = new Map<string, TagDemand>();
      for (const d of demand) byTerm.set(d.tag, d);

      anchorKeywords = {
        ...anchorKeywords,
        topPhrases: anchorKeywords.topPhrases.map((p) => {
          const d = byTerm.get(p.phrase);
          return d
            ? { ...p, demand: { totalListings: d.totalListings, tier: d.tier } }
            : p;
        }),
        topTags: anchorKeywords.topTags.map((t) => {
          const d = byTerm.get(t.phrase);
          return d
            ? { ...t, demand: { totalListings: d.totalListings, tier: d.tier } }
            : t;
        }),
      };
    }
  } catch (err) {
    // Non-fatal — fall through with unscored anchors. Sonnet still has
    // the demand-distribution rules in the system prompt to guide it;
    // Layer 2 (post-swap below) is the catch-all safety net.
    console.warn(
      "[seo-autopilot] anchor demand pre-check failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // ─── Stage 4 — Sonnet writes the listing (with vision) ─────────────
  //
  // When `reframe` is set, the reframe constraints get threaded into
  // the Sonnet user prompt as hard rules (avoid these exact words,
  // frame the listing as X, follow these title/tag/description
  // guidance bullets). That's how the policy-safe rewrite happens.

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
        reframeConstraints: reframe
          ? {
              listingApproach: reframe.listingApproach,
              titleGuidance: reframe.titleGuidance,
              tagGuidance: reframe.tagGuidance,
              descriptionGuidance: reframe.descriptionGuidance,
              avoidWords: reframe.avoidWords,
            }
          : undefined,
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

  // ─── Stage 4.5 — Output sanity check (avoid-word leak) ────────────
  //
  // Free regex sweep. If Sonnet accidentally included any avoid-word
  // (rare with the prompt above, but possible), we strip the listing's
  // textual fields rather than ship a listing that'll get flagged. The
  // strip is a programmatic last-line-of-defense — we don't re-call
  // Sonnet because the prompt already explicitly forbids these words.
  if (reframe && reframe.avoidWords.length > 0) {
    const leakedWords: string[] = [];
    for (const word of reframe.avoidWords) {
      const wordEscaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${wordEscaped}\\b`, "gi");
      const titleHit = re.test(listing.title);
      re.lastIndex = 0;
      const descHit = re.test(listing.description);
      re.lastIndex = 0;
      const tagHit = listing.tags.some((t) => {
        re.lastIndex = 0;
        return re.test(t);
      });
      re.lastIndex = 0;
      const altHit = listing.altTexts.some((a) => {
        re.lastIndex = 0;
        return re.test(a);
      });
      if (titleHit || descHit || tagHit || altHit) {
        leakedWords.push(word);
        // Strip from title + description + alts (best-effort scrub).
        listing.title = listing.title.replace(re, "").replace(/\s+/g, " ").trim();
        listing.description = listing.description
          .replace(re, "")
          .replace(/\s+/g, " ")
          .trim();
        listing.altTexts = listing.altTexts.map((a) =>
          a.replace(re, "").replace(/\s+/g, " ").trim(),
        );
        // Drop any tags that matched.
        listing.tags = listing.tags.filter((t) => !re.test(t));
      }
    }
    if (leakedWords.length > 0) {
      console.warn(
        `[seo-autopilot] avoid-word leak scrubbed: ${leakedWords.join(", ")}`,
      );
    }
  }

  // ─── Stage 4.6 — QC GATE (deterministic-first, regenerate weak output) ──
  //
  // Guarantees 13 unique tags + a conversion-grade description BEFORE we
  // commit the slot. This whole block runs while refundOnFailure is still
  // true and checkAndConsume has run exactly once, so every retry here is
  // FREE on the user's daily quota — only Anthropic tokens (billed to
  // costAccum) are spent. Bounded by retries + cost ceiling + wall-clock
  // so a slow listing never times the request out.
  const QC_SCORE_MIN = 70;
  const QC_MAX_DESC_RETRIES = 2;
  const QC_COST_CEILING_USD = 0.12;
  const qcDeadline = Date.now() + 12_000;

  // (a) Tags — normalize() already ran enforceTagUniqueness, so tags are
  // unique. If it came up SHORT of 13 (the model supplied too few distinct
  // angles), do ONE tags-only regen and re-fold. Never shrinks the set.
  if (listing.tags.length < 13) {
    try {
      const fresh = await regenerateTags(
        { categoryPath: category.path, approvedTitle: listing.title },
        costAccum,
      );
      if (fresh.length > 0) {
        const refolded = enforceTagUniqueness(fresh, listing.tags);
        if (refolded.tags.length >= listing.tags.length) {
          listing.tags = refolded.tags;
        }
      }
    } catch (err) {
      console.warn(
        "[seo-autopilot] tags regen failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // (b) Description — always score it (the only reliable signal for weak /
  // robotic copy) and regenerate the DESCRIPTION ONLY on failure. Title +
  // tags stay frozen, so tag uniqueness can never be undone by a rewrite.
  // Keep the best-scoring attempt so a retry never ships worse copy.
  let bestDescription = listing.description;
  let bestScore = -1;
  let bestClean = false; // a hard-failing attempt must never win over a clean one
  for (let attempt = 0; attempt <= QC_MAX_DESC_RETRIES; attempt++) {
    const score = await scoreDescription(listing.description, costAccum).catch(
      () => null,
    );
    if (!score) break; // scorer unavailable → ship what we have
    const hardFail =
      score.hasNarrativeOpening ||
      score.hasSceneDirection ||
      score.hasShippingLanguage ||
      score.hasMtoWording ||
      score.hasBannedTrademark ||
      score.missingHook ||
      score.missingWhoItsFor ||
      score.notBenefitLed;
    const clean = !hardFail;
    // Hard-fail-aware "best": a clean (no banned-language) attempt ALWAYS
    // beats a hard-failing one regardless of numeric score; within the same
    // bucket the higher score wins. Prevents shipping a shipping/MTO/IP/
    // fiction description over a compliant rewrite just because Haiku gave
    // the banned one a higher number.
    if (
      bestScore < 0 ||
      (clean && !bestClean) ||
      (clean === bestClean && score.overallScore > bestScore)
    ) {
      bestScore = score.overallScore;
      bestDescription = listing.description;
      bestClean = clean;
    }
    const passed = score.overallScore >= QC_SCORE_MIN && !hardFail;
    if (passed || attempt === QC_MAX_DESC_RETRIES) break;
    if (Date.now() > qcDeadline || costAccum.totalCostUsd > QC_COST_CEILING_USD)
      break;
    const rewritten = await regenerateDescription(
      {
        categoryPath: category.path,
        approvedTitle: listing.title,
        approvedTags: listing.tags,
        avoidWords: reframe?.avoidWords ?? [],
        failingItems: score.failingItems,
      },
      costAccum,
    ).catch(() => null);
    if (!rewritten) break;
    listing.description = rewritten;
  }
  // Ship the best-scoring description we produced (monotonic — never worse).
  if (bestScore >= 0) listing.description = bestDescription;

  // Listing successfully generated — the slot is now permanently consumed.
  refundOnFailure = false;

  // Final verdict for the audit log + UI:
  //   - "ALLOWED" → no flags at all, clean generation
  //   - "REVIEW"  → soft-flagged + reframe applied (IP-adjusted)
  //   - "BLOCKED" can no longer reach this point (rule engine
  //     short-circuited those much earlier)
  const finalVerdict = reframe ? "REVIEW" : "ALLOWED";

  // The raw `compliance` object from vision can still hold verdict
  // "BLOCKED" or "REVIEW" if Sonnet vision flagged the photo. By this
  // point we've RESOLVED that signal (reframe ran, the listing is
  // policy-safe), so override it to the real outcome for the UI.
  const resolvedCompliance: ComplianceVerdict = reframe
    ? {
        verdict: "REVIEW",
        concerns: compliance.concerns,
        summary: compliance.summary,
      }
    : compliance;

  // ─── Stage 5 — Tag intelligence ────────────────────────────────────
  let tagIntelligence: TagDemand[] = await getTagDemandStatsBatch(
    listing.tags,
  ).catch(() => []);

  // ─── Stage 5.5 — Auto-swap saturated tags ──────────────────────────
  //
  // Any final tag with >=50k listings is a wasted slot for a new shop.
  // We PROPOSE replacements in parallel (the costly Etsy demand lookups
  // stay concurrent) but COMMIT them SERIALLY against a mutating
  // canonical-claim set, so two parallel proposals can never land the
  // same tag — or a singular/plural variant of it. Collision-free by
  // construction (the old code committed in parallel with no dedup and
  // could emit identical tags at different indices).
  const SATURATED_THRESHOLD = 50_000;
  const saturatedTags = tagIntelligence
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.totalListings >= SATURATED_THRESHOLD);

  // Declared in the outer scope so the final uniqueness pass below can
  // mine every demand-validated proposal as a refill reserve.
  let swapResults: {
    i: number;
    currentTag: string;
    ranked: { tag: string; stats: TagDemand }[];
  }[] = [];

  if (saturatedTags.length > 0) {
    console.log(
      `[seo-autopilot] ${saturatedTags.length}/${listing.tags.length} tags saturated, auto-swapping…`,
    );

    // PROPOSE — each job returns ALL demand-validated, non-saturated
    // candidates for its slot, ranked best-first. No in-place mutation.
    swapResults = await Promise.all(
      saturatedTags.map(async ({ d, i }) => {
        try {
          const existingTags = listing.tags.filter((_, j) => j !== i);
          const replacements = await suggestTagReplacements(
            {
              currentTag: d.tag,
              productTitle: listing.title,
              productType: context.productType,
              category: category!.path,
              existingTags,
              reason: `Original tag had ${d.totalListings.toLocaleString()} Etsy listings (saturated). Need niche/moderate alternative.`,
            },
            costAccum,
          );
          const ranked: { tag: string; stats: TagDemand }[] = [];
          for (const r of replacements) {
            if (existingTags.includes(r.tag)) continue;
            const stats = await getTagDemandStats(r.tag).catch(() => null);
            if (!stats) continue;
            if (stats.totalListings >= SATURATED_THRESHOLD) continue;
            ranked.push({ tag: r.tag, stats });
          }
          return { i, currentTag: d.tag, ranked };
        } catch (err) {
          console.warn(
            `[seo-autopilot] swap proposal failed for "${d.tag}":`,
            err instanceof Error ? err.message : err,
          );
          return {
            i,
            currentTag: d.tag,
            ranked: [] as { tag: string; stats: TagDemand }[],
          };
        }
      }),
    );

    // COMMIT — serially, claiming canonical forms as we go so no two
    // swaps (or a swap + a kept tag) can collapse to the same keyword.
    const swappingIdx = new Set(saturatedTags.map(({ i }) => i));
    const claimed = new Set(
      listing.tags
        .filter((_, j) => !swappingIdx.has(j))
        .map(tagCanonical),
    );
    let swappedCount = 0;
    for (const result of swapResults) {
      const pick = result.ranked.find((r) => !claimed.has(tagCanonical(r.tag)));
      if (!pick) {
        console.warn(
          `[seo-autopilot] no collision-free swap for "${result.currentTag}" — leaving it for the final pass`,
        );
        continue;
      }
      listing.tags[result.i] = pick.tag;
      tagIntelligence[result.i] = pick.stats;
      claimed.add(tagCanonical(pick.tag));
      swappedCount++;
    }
    if (swappedCount > 0) {
      console.log(`[seo-autopilot] auto-swapped ${swappedCount} saturated tags`);
    }
  }

  // ─── Stage 5.6 — Final tag-uniqueness catch-all (ALWAYS runs) ───────
  //
  // The mathematical guarantee the route.ts comment always promised. No
  // matter what the swap did, this folds exact + near duplicates and
  // refills any freed slot from a moderate/niche reserve (rejected swap
  // candidates + unused moderate/niche anchors). Cannot emit a duplicate.
  let reservePool: string[] = [
    ...swapResults.flatMap((r) => r.ranked.map((x) => x.tag)),
    ...anchorKeywords.topTags
      .filter(
        (t) =>
          t.demand &&
          (t.demand.tier === "moderate" || t.demand.tier === "niche"),
      )
      .map((t) => t.phrase),
    ...anchorKeywords.topPhrases
      .filter(
        (p) =>
          p.demand &&
          (p.demand.tier === "moderate" || p.demand.tier === "niche"),
      )
      .map((p) => p.phrase),
  ];
  // Final avoid-word scrub for reframed listings — Stage 4.5 ran BEFORE the
  // QC rewrite + swap, so re-strip any banned term from the FINAL description,
  // tags, AND the reserve here (the deterministic last-line-of-defense for IP
  // reframes). Filtering the reserve means the refill below can't re-add one;
  // any tag dropped here is topped back up to 13 by enforceTagUniqueness.
  if (reframe && reframe.avoidWords.length > 0) {
    const avoidRes = buildAvoidRegexes(reframe.avoidWords);
    listing.description = stripAvoidFromText(listing.description, avoidRes);
    listing.tags = dropAvoidTags(listing.tags, avoidRes);
    reservePool = dropAvoidTags(reservePool, avoidRes);
  }
  const tagsBefore = listing.tags.join("|");
  const finalTags = enforceTagUniqueness(listing.tags, reservePool);
  listing.tags = finalTags.tags;
  if (finalTags.short) {
    console.warn(
      `[seo-autopilot] final tag set is short: ${listing.tags.length}/13 distinct tags available`,
    );
  }
  // Keep tagIntelligence index-aligned with the final tags for the UI.
  if (listing.tags.join("|") !== tagsBefore) {
    tagIntelligence = await getTagDemandStatsBatch(listing.tags).catch(
      () => tagIntelligence,
    );
  }

  // ─── Audit log — MOVED here so the snapshot + actualCostUsd reflect the
  //     FINAL shipped listing (including QC retries + swap + final pass) ──
  await logGeneration({
    userId: u.id,
    sourceTitle: payload.aliExpressTitle,
    generatedTitle: listing.title,
    verdict: finalVerdict,
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

  return json({
    compliance: resolvedCompliance,
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
    // Reframe metadata — present when the rule engine OR vision flagged
    // the source product as soft-policy-risk.
    reframe: reframe
      ? {
          flaggedRules: ruleHits.map((h) => ({
            label: h.rule.label,
            matchedText: h.matchedText,
            policyClause: h.rule.policyClause,
          })),
          avoidWords: reframe.avoidWords,
          photoGuidance: reframe.photoGuidance,
        }
      : null,
    // Echo back the SEO-relevant inputs so the UI can show the
    // variations / personalization sections in the result.
    inputs: {
      sizes: payload.sizes,
      variants: payload.variants,
    },
    generatedAt: new Date().toISOString(),
  });
}
