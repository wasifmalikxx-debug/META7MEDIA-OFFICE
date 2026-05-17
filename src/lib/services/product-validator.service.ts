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
 *
 * Cost: zero. No Claude calls, only the AE DS API (free under our
 * 5K/day quota).
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

export interface ProductValidatorInput {
  /** AliExpress.com URL or numeric product ID. Optional if `manualTitle` is provided. */
  url?: string;
  /** Manual entry fallback when the seller has the title in hand. */
  manualTitle?: string;
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
  /** Diagnostics for the toast: how the product was fetched. */
  fetchPath: "ds_api" | "manual";
  durationMs: number;
}

const VERDICT_SUMMARIES: Record<ValidationVerdict, string> = {
  BLOCKED:
    "This product violates Etsy policy. Listing it will likely result in removal and a shop strike.",
  REVIEW:
    "Caution required. Reframe the title or modify the product before listing.",
  SAFE: "No policy issues detected. Cleared for listing.",
};

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

  return {
    verdict,
    summary: VERDICT_SUMMARIES[verdict],
    flags,
    product: {
      title,
      imageUrl,
      priceUsd,
      productUrl,
      source,
    },
    fetchPath,
    durationMs: Date.now() - startedAt,
  };
}
