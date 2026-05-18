/**
 * Product Validator service.
 *
 * Takes an AliExpress.com URL (or numeric product ID), or a manual
 * title from the seller, and returns a verdict on whether the product
 * can be listed on Etsy without getting removed.
 *
 * Pipeline:
 *   1. Validate the URL is a .com link or numeric ID. Regional
 *      storefronts (.us / .ru / etc.) are rejected at the API layer
 *      already — see /api/product-validator. The seller is asked to
 *      switch their AliExpress region from United States to Pakistan
 *      to surface the .com version of the same product.
 *   2. Extract product ID and call AE DS API `getProductById`.
 *   3. Run the title against ETSY_POLICY_RULES → list of hits.
 *   4. Roll up to a verdict: BLOCKED / REVIEW / SAFE.
 *   5. For REVIEW verdicts only, call Claude Haiku 4.5 with the four
 *      Etsy policies as system context to produce Etsy-safe listing
 *      guidance + photo-regen coaching (see product-validator-reframe).
 *
 * Cost:
 *   - SAFE   $0    (rule engine only, no AI call)
 *   - BLOCKED $0   (rule engine only, hard category bans)
 *   - REVIEW ~$0.006 (one Haiku call with vision)
 *
 * Tone: balanced advisor — only flag what is likely to actually get a
 * listing removed. Don't drown the seller in warnings about every
 * mass-produced item; focus on the patterns Etsy's enforcement
 * actually picks up on.
 */

import {
  extractProductId,
  getProductById,
  type AliExpressProduct,
} from "./aliexpress-api.service";
import {
  evaluatePolicyRules,
  rollupVerdict,
  type ValidationVerdict,
} from "./etsy-policy-rules";
import {
  reframeForEtsy,
  type ReframeResult,
  type FetchedImage,
} from "./product-validator-reframe.service";

export interface ProductValidatorInput {
  /** AliExpress.com URL or numeric product ID. Optional if `manualTitle` is provided. */
  url?: string;
  /** Manual entry fallback when the seller has the title in hand. */
  manualTitle?: string;
  /**
   * Manual-check uploaded photos (base64, no data: prefix). The team's
   * regen pass operates on these — passing them to the reframe service
   * lets vision generate specific photo-regen guidance.
   */
  manualImages?: FetchedImage[];
}

export interface ValidationFlag {
  severity: "block" | "review";
  policy: string;
  policyClause: string;
  label: string;
  matchedText: string;
  explanation: string;
  suggestion?: string;
}

export interface ProductValidatorResult {
  verdict: ValidationVerdict;
  /** One-line summary the UI shows in the verdict pill. */
  summary: string;
  /** Every policy hit, in BLOCK-first order for display. */
  flags: ValidationFlag[];
  product: {
    title: string;
    imageUrl: string | null;
    priceUsd: number | null;
    productUrl: string;
    /** Origin of the data shown in the result. */
    source: "com" | "manual";
  };
  /**
   * AI reframe — only populated for REVIEW verdicts. BLOCKED products
   * are hard category bans (firearms, drugs, hate, adult, PPE, animals)
   * where no reframe is possible, so the reframe step is skipped.
   * SAFE products don't need a reframe either.
   */
  reframe: ReframeResult | null;
  /**
   * Set when the reframe step was attempted but failed (timeout,
   * Anthropic 5xx, malformed JSON). The verdict + flags are still
   * valid; the UI shows a small fallback note where the reframe panel
   * would otherwise render. Null when reframe wasn't attempted at all
   * (SAFE / BLOCKED) or when it succeeded.
   */
  reframeError: string | null;
  /** Diagnostics for the toast: how the product was fetched. */
  fetchPath: "ds_api" | "manual";
  durationMs: number;
}

/**
 * Build a single-sentence summary that names the actual reason(s) the
 * verdict came out the way it did.
 *
 *   SAFE     → static cleared message
 *   REVIEW   → "Flagged for review — {reason 1}, {reason 2}, ..."
 *   BLOCKED  → "Flagged: {label 1} (matched 'x'), {label 2} (matched 'y') —
 *               violates {primary policy clause}"
 *
 * Sellers see the actual policy reason on the verdict card itself
 * instead of having to scroll into the Findings panel to find it.
 */
function buildVerdictSummary(
  verdict: ValidationVerdict,
  flags: ValidationFlag[],
): string {
  if (verdict === "SAFE") {
    return "No policy issues detected. Cleared for listing as-is.";
  }

  if (flags.length === 0) {
    return verdict === "BLOCKED"
      ? "Cannot be listed — this product is in an Etsy-banned category."
      : "Listable with reframing — use the safe content generated below.";
  }

  const top = flags[0];
  const more = flags.length - 1;
  const moreSuffix =
    more === 0 ? "" : more === 1 ? " + 1 more issue" : ` + ${more} more issues`;

  if (verdict === "BLOCKED") {
    return `Cannot be listed: ${top.label.toLowerCase()} — matched "${top.matchedText}" against ${top.policyClause}${moreSuffix}. This is a category ban; no reframing will save it.`;
  }

  // REVIEW = "Listable with care" — AI reframe is provided below
  return `Listable with care: ${top.label.toLowerCase()} — matched "${top.matchedText}" against ${top.policyClause}${moreSuffix}. Use the Etsy-safe content generated below.`;
}

/**
 * Main validator entry point. Caller passes EITHER url OR manualTitle.
 *
 * Access control happens at the API route layer (see /api/product-validator).
 */
export async function validateProduct(
  input: ProductValidatorInput,
  options: { accessToken?: string } = {},
): Promise<ProductValidatorResult> {
  const startedAt = Date.now();

  let title = "";
  let imageUrl: string | null = null;
  let priceUsd: number | null = null;
  let productUrl = "";
  let source: "com" | "manual" = "manual";
  let fetchPath: ProductValidatorResult["fetchPath"] = "manual";

  if (input.manualTitle) {
    title = input.manualTitle.trim();
    productUrl = input.url?.trim() ?? "";
    source = "manual";
    fetchPath = "manual";
  } else if (input.url) {
    const url = input.url.trim();
    productUrl = url;

    // Defensive: regional storefront URLs are already blocked at the
    // API route layer. If one slips through, fail fast with a clear
    // message instead of attempting a doomed lookup.
    if (/aliexpress\.(us|ru|fr|de|es|it|pl|nl|co\.kr|co\.jp)/i.test(url)) {
      throw new Error(
        "Only aliexpress.com URLs are accepted. Change the AliExpress shipping region to Pakistan to get the .com version of this product.",
      );
    }

    const productId = /^\d+$/.test(url) ? url : extractProductId(url);
    if (!productId) {
      throw new Error(
        "Could not extract a product ID from that URL. Paste a full aliexpress.com product link or use manual entry.",
      );
    }

    source = "com";

    if (!options.accessToken) {
      throw new Error(
        "AliExpress connection is not available right now. Use manual entry to validate this product.",
      );
    }

    // getProductById now throws on API failures (auth, rate-limit,
    // permission) and only returns null for empty-parse results. We
    // surface each failure mode with a distinct message so the seller
    // knows whether to retry, switch tools, or use manual entry.
    let aeProduct: AliExpressProduct | null = null;
    try {
      aeProduct = await getProductById(productId, {
        accessToken: options.accessToken,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      console.warn(
        `[product-validator] DS API error for ${productId}: ${raw}`,
      );

      if (/InvalidAccessToken|AccessTokenExpired|invalid_token|expired/i.test(raw)) {
        throw new Error(
          "AliExpress connection expired. Ask Wasif to reconnect on Product Hunter, then retry.",
        );
      }
      if (/InsufficientPermission|Permission/i.test(raw)) {
        throw new Error(
          "AliExpress denied access to this product. Use manual entry to validate.",
        );
      }
      if (/429|rate.?limit|FrequencyExceeded/i.test(raw)) {
        throw new Error(
          "AliExpress rate limit hit. Wait a few seconds and retry, or use manual entry.",
        );
      }
      throw new Error(
        `AliExpress lookup failed (${raw.slice(0, 120)}). Use manual entry to validate.`,
      );
    }

    // Title is the only field the rules need; price/image are display
    // only. Accept any response that carries a non-empty title.
    const hasTitle =
      aeProduct && aeProduct.title && aeProduct.title.trim().length > 0;

    if (!hasTitle || !aeProduct) {
      console.warn(
        `[product-validator] DS API returned no title for product ${productId}` +
          (aeProduct
            ? ` (got fields: ${Object.keys(aeProduct as unknown as Record<string, unknown>)
                .filter(
                  (k) =>
                    (aeProduct as unknown as Record<string, unknown>)[k] !=
                    null,
                )
                .join(", ")})`
            : " (null parse)"),
      );
      throw new Error(
        `AliExpress returned no usable data for product ${productId}. The product may be deleted, region-locked, or temporarily unavailable. Use manual entry to validate.`,
      );
    }

    title = aeProduct.title;
    imageUrl = aeProduct.imageUrl ?? null;
    priceUsd =
      aeProduct.priceMin && aeProduct.priceMin > 0
        ? aeProduct.priceMin
        : null;
    fetchPath = "ds_api";
  } else {
    throw new Error(
      "Either a product URL or a manual title is required.",
    );
  }

  if (!title || title.trim().length < 3) {
    throw new Error(
      "Product title is empty or too short to validate.",
    );
  }

  const hits = evaluatePolicyRules(title);

  // Block-severity flags first so the most important issues sit at
  // the top of the result list.
  const ordered = [...hits].sort((a, b) => {
    if (a.rule.severity === b.rule.severity) return 0;
    return a.rule.severity === "block" ? -1 : 1;
  });

  const flags: ValidationFlag[] = ordered.map((hit) => ({
    severity: hit.rule.severity,
    policy: hit.rule.policy,
    policyClause: hit.rule.policyClause,
    label: hit.rule.label,
    matchedText: hit.matchedText,
    explanation: hit.rule.explanation,
    suggestion: hit.rule.suggestion,
  }));

  const verdict = rollupVerdict(hits);

  // ── AI reframe for REVIEW verdicts ──────────────────────────────
  // Hard-blocked products (BLOCKED) get no reframe — they're banned
  // by category, no clever wording saves them. SAFE products don't
  // need one. REVIEW is where the work happens.
  let reframe: ReframeResult | null = null;
  let reframeError: string | null = null;
  if (verdict === "REVIEW") {
    try {
      reframe = await reframeForEtsy({
        title,
        flags,
        imageUrl: imageUrl ?? undefined,
        manualImages: input.manualImages,
      });
      console.log(
        `[product-validator] reframe ok in ${reframe.costUsd.toFixed(4)} USD (vision=${reframe.visionUsed})`,
      );
    } catch (err) {
      // Reframe failure is non-fatal — return the rule verdict with
      // a captured error message so the UI can render a fallback
      // note instead of a silent gap where the reframe panel would
      // have been.
      reframeError = err instanceof Error ? err.message : String(err);
      console.warn("[product-validator] reframe failed:", reframeError);
    }
  }

  return {
    verdict,
    summary: buildVerdictSummary(verdict, flags),
    flags,
    product: {
      title,
      imageUrl,
      priceUsd,
      productUrl,
      source,
    },
    reframe,
    reframeError,
    fetchPath,
    durationMs: Date.now() - startedAt,
  };
}
