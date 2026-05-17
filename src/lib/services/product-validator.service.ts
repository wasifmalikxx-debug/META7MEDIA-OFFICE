/**
 * Product Validator service.
 *
 * Takes an AliExpress URL (.com or .us) and returns a verdict on
 * whether the product can be listed on Etsy without getting removed.
 *
 * Pipeline:
 *   1. Extract product ID + detect storefront (.com vs .us)
 *   2. Fetch product data:
 *      - .com / global IDs → AE DS API getProductById
 *      - .us regional IDs  → HTML scrape (DS API doesn't serve them)
 *   3. Run title against ETSY_POLICY_RULES → list of hits
 *   4. Roll up to verdict: BLOCKED / REVIEW / SAFE
 *
 * Cost: zero — no Claude calls, just AE API (free under our quota)
 * + optional HTML fetch for .us URLs.
 *
 * Tone: balanced — only flag what's likely to actually get a
 * listing removed. Don't drown the team in warnings about every
 * mass-produced commodity.
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
  /** AliExpress URL or numeric product ID. Optional if `manualTitle` is provided. */
  url?: string;
  /** Manual entry fallback for .us URLs where auto-fetch fails. */
  manualTitle?: string;
  /** Optional preview image for manual mode. */
  manualImageUrl?: string;
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
    /** Which AE storefront the product came from (drives the badge in the UI). */
    source: "com" | "us" | "manual";
  };
  /** Diagnostics for the toast: how the product was fetched. */
  fetchPath: "ds_api" | "html_scrape" | "manual";
  durationMs: number;
}

const VERDICT_SUMMARIES: Record<ValidationVerdict, string> = {
  BLOCKED:
    "Don't list this — it violates Etsy policy and will be removed (likely with a shop strike).",
  REVIEW:
    "Risky — list only after reframing the title or customizing the product.",
  SAFE: "Looks safe to list — no policy red flags caught.",
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
  let source: "com" | "us" | "manual" = "manual";
  let fetchPath: ProductValidatorResult["fetchPath"] = "manual";

  if (input.manualTitle) {
    title = input.manualTitle.trim();
    imageUrl = input.manualImageUrl?.trim() || null;
    productUrl = input.url?.trim() ?? "";
    source = "manual";
    fetchPath = "manual";
  } else if (input.url) {
    const url = input.url.trim();
    productUrl = url;

    const productId = /^\d+$/.test(url) ? url : extractProductId(url);
    if (!productId) {
      throw new Error(
        "Couldn't extract a product ID from that URL. Paste an AliExpress product link or use manual entry.",
      );
    }

    // Detect .us regional storefront. Their product IDs start with
    // "3256" and the global DS API often returns empty data for them.
    const isUsRegionalId = productId.startsWith("3256");
    const isUsRegionalUrl = /aliexpress\.(us|ru|fr|de|es|it|pl)/i.test(url);
    source = isUsRegionalId || isUsRegionalUrl ? "us" : "com";

    // Try DS API first
    let aeProduct: AliExpressProduct | null = null;
    if (options.accessToken) {
      try {
        aeProduct = await getProductById(productId, {
          accessToken: options.accessToken,
        });
      } catch (err) {
        console.warn(
          `[product-validator] DS API error for ${productId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // For validation we only really need the title. Price is nice-
    // to-have for display. So we accept DS API responses that have
    // a non-empty title even if the price came back as 0 — better
    // than falsely falling through to HTML scrape when the title is
    // perfectly readable.
    const dsHasData =
      aeProduct &&
      aeProduct.title &&
      aeProduct.title.trim().length > 0;

    if (dsHasData && aeProduct) {
      title = aeProduct.title;
      imageUrl = aeProduct.imageUrl ?? null;
      // priceMin can be 0/undefined for some AE responses; store as
      // null in those cases so the UI shows "—" instead of "$0.00".
      priceUsd =
        aeProduct.priceMin && aeProduct.priceMin > 0
          ? aeProduct.priceMin
          : null;
      fetchPath = "ds_api";
    } else {
      // DS API returned empty — try HTML scrape (works for .us
      // sometimes, and as a general fallback). Fails gracefully.
      const scraped = await fetchAeProductFromHtml(url);
      if (scraped) {
        title = scraped.title;
        imageUrl = scraped.imageUrl;
        priceUsd = scraped.priceUsd > 0 ? scraped.priceUsd : null;
        fetchPath = "html_scrape";
      } else {
        // Both paths failed — give the user a clear next step.
        if (source === "us") {
          throw new Error(
            "Couldn't auto-load this aliexpress.us product. Switch to manual entry and paste the title from the AE page.",
          );
        }
        throw new Error(
          "AliExpress returned no usable data for this product. Try manual entry instead.",
        );
      }
    }
  } else {
    throw new Error(
      "Either a product URL or a manual title is required.",
    );
  }

  // Final sanity check — title is the only thing the rules need
  if (!title || title.trim().length < 3) {
    throw new Error(
      "Product title is empty or too short to validate.",
    );
  }

  // Run all policy rules
  const hits = evaluatePolicyRules(title);

  // Order flags: block-severity first (more important), then review.
  // Within each, preserve rule order (which is policy-clustered).
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

// ─── AE product page HTML scrape (for .us regional URLs) ────────────
//
// AE's DS API doesn't serve the .us regional catalog. For those URLs
// we fetch the product page HTML directly and extract title + image +
// price from meta tags + embedded JSON.
//
// Best-effort — returns null on any failure (HTTP error, missing
// fields, Cloudflare challenge, etc.) and the caller falls through
// to either the friendly error or manual entry.

const SCRAPE_TIMEOUT_MS = 10_000;

interface ScrapedProduct {
  title: string;
  imageUrl: string | null;
  priceUsd: number;
}

async function fetchAeProductFromHtml(
  productUrl: string,
): Promise<ScrapedProduct | null> {
  const startedAt = Date.now();
  let html: string;
  try {
    const res = await fetch(productUrl, {
      headers: {
        // Look like a real browser so AE doesn't serve a stripped bot variant
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `[product-validator] HTML scrape: HTTP ${res.status} in ${Date.now() - startedAt}ms`,
      );
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.warn(
      `[product-validator] HTML scrape failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  // og:title — works on virtually every AE product page
  const titleRaw = html
    .match(
      /<meta[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    )?.[1]
    ?.trim();

  // og:image — used for the card thumbnail
  const imageUrlMatch = html
    .match(
      /<meta[^>]+(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    )?.[1]
    ?.trim();

  // Price — AE embeds in __INIT_DATA__ / window.runParams JSON
  const priceMatch =
    html.match(/"salePrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/) ??
    html.match(/"appSalePrice"\s*:[^{]*"value"\s*:\s*"?([0-9]+\.?[0-9]*)/) ??
    html.match(/"app_sale_price"\s*:\s*"([0-9]+\.?[0-9]*)"/) ??
    html.match(/"targetSalePrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/) ??
    html.match(/"actMinPrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/);

  if (!titleRaw) {
    console.warn(`[product-validator] HTML scrape: no og:title found`);
    return null;
  }

  // Price is optional for the validator — we only need the title for
  // rule matching. Missing price is fine, we just display "—".
  const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
  const validPrice = isFinite(price) && price > 0 && price < 10000 ? price : 0;

  const title = decodeHtmlEntities(titleRaw);
  console.log(
    `[product-validator] HTML scrape ok in ${Date.now() - startedAt}ms — "${title.slice(0, 60)}"`,
  );

  return {
    title,
    imageUrl: imageUrlMatch ?? null,
    priceUsd: validPrice,
  };
}

/** Minimal HTML entity decoder for the title field. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}
