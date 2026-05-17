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
// price from:
//   1. JSON-LD structured data (most reliable — required for Google
//      Shopping rich results, so AE includes it)
//   2. og:title + og:image meta tags (universal SEO)
//   3. <title> tag (last-resort fallback)
//   4. Embedded JSON for the price (window.runParams / __INIT_DATA__)
//
// Tries multiple URL variants + browser identities to defeat
// Cloudflare bot detection that flagged our first attempts:
//   a. Desktop Chrome User-Agent on the canonical URL
//   b. Mobile Chrome User-Agent on the m. subdomain
//   c. Googlebot identity (often whitelisted for SEO)
//
// Stops as soon as ANY variant successfully extracts a title.

const SCRAPE_TIMEOUT_MS = 12_000;

interface ScrapedProduct {
  title: string;
  imageUrl: string | null;
  priceUsd: number;
}

interface ScrapeAttempt {
  url: string;
  headers: Record<string, string>;
  label: string;
}

function buildScrapeAttempts(productUrl: string): ScrapeAttempt[] {
  const desktopChrome =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const mobileChrome =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
  const googleBot =
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

  // Build a realistic browser request — modern Cloudflare bot scoring
  // expects these headers from real Chrome.
  const browserHeaders = {
    "User-Agent": desktopChrome,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Ch-Ua":
      '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    // Coming from Google search makes us look like a real user click
    Referer: "https://www.google.com/",
  };

  // Mobile variant — same product on m.aliexpress.us (lighter HTML,
  // sometimes serves through a different Cloudflare config).
  const mobileUrl = productUrl
    .replace(/^https?:\/\/(www\.)?/i, "https://m.")
    .replace("m.aliexpress.us", "m.aliexpress.us")
    .replace("m.aliexpress.com", "m.aliexpress.com");

  // Free public CORS proxies — these fetch the URL from THEIR
  // infrastructure (different IP than Vercel) and return the raw
  // HTML to us. AE's Cloudflare instance treats them as separate
  // origin requests, often allowing what it blocks for Vercel.
  // Both are no-signup, no-credit, totally free.
  //
  // NOTE: format quirks differ between proxies —
  //   AllOrigins:  ?url=<ENCODED>      (standard query param)
  //   CorsProxy:   ?<RAW_URL>          (URL appended raw, NOT encoded —
  //                                     encoding makes corsproxy return
  //                                     its OWN homepage instead of
  //                                     fetching the target → that was
  //                                     the May 17 false-SAFE bug)
  const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(productUrl)}`;
  const corsProxyUrl = `https://corsproxy.io/?${productUrl}`;

  return [
    {
      label: "desktop-chrome",
      url: productUrl,
      headers: browserHeaders,
    },
    {
      label: "mobile-chrome",
      url: mobileUrl,
      headers: {
        ...browserHeaders,
        "User-Agent": mobileChrome,
        "Sec-Ch-Ua-Mobile": "?1",
        "Sec-Ch-Ua-Platform": '"iOS"',
      },
    },
    {
      label: "googlebot",
      url: productUrl,
      headers: { "User-Agent": googleBot, Accept: "text/html,*/*" },
    },
    {
      label: "allorigins-proxy",
      url: allOriginsUrl,
      headers: { "User-Agent": desktopChrome },
    },
    {
      label: "corsproxy-io",
      url: corsProxyUrl,
      headers: { "User-Agent": desktopChrome },
    },
  ];
}

async function fetchAeProductFromHtml(
  productUrl: string,
): Promise<ScrapedProduct | null> {
  const attempts = buildScrapeAttempts(productUrl);

  for (const attempt of attempts) {
    const startedAt = Date.now();
    try {
      const res = await fetch(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) {
        console.warn(
          `[product-validator] HTML scrape (${attempt.label}): HTTP ${res.status} in ${Date.now() - startedAt}ms`,
        );
        continue;
      }
      const html = await res.text();
      const extracted = extractProductFromHtml(html);
      if (extracted) {
        console.log(
          `[product-validator] HTML scrape (${attempt.label}) ok in ${Date.now() - startedAt}ms — "${extracted.title.slice(0, 60)}"`,
        );
        return extracted;
      }
      console.warn(
        `[product-validator] HTML scrape (${attempt.label}): page loaded (${html.length} bytes) but couldn't extract product`,
      );
    } catch (err) {
      console.warn(
        `[product-validator] HTML scrape (${attempt.label}) failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return null;
}

/**
 * Try multiple extraction strategies in order of reliability.
 *
 * 1. JSON-LD <script type="application/ld+json"> — schema.org Product
 *    structured data. Google Shopping requires this so AE includes it
 *    on every product page. Most reliable extraction path.
 * 2. og:title + og:image meta tags — universal SEO tags.
 * 3. <title> tag — last resort, often noisy with site branding suffix.
 *
 * Price is extracted from JSON-LD or embedded window.runParams JSON
 * patterns.
 *
 * GATED by looksLikeAliExpressPage() — without this gate, a proxy
 * returning its OWN homepage (e.g. CorsProxy's "CORSPROXY — Fix
 * CORS Errors" page after we mangled the URL format) would be parsed
 * as a product and give the user a dangerous false-SAFE verdict on
 * completely wrong data. Added May 17 2026 after exactly that bug.
 */
function extractProductFromHtml(html: string): ScrapedProduct | null {
  if (!looksLikeAliExpressPage(html)) return null;

  // Path 1: JSON-LD Product schema
  const fromJsonLd = extractFromJsonLd(html);
  if (fromJsonLd) return fromJsonLd;

  // Path 2: og:title + og:image
  const ogTitleMatch = html.match(
    /<meta[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  );
  const ogImageMatch = html.match(
    /<meta[^>]+(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i,
  );

  // Path 3: <title> tag (strip ' - AliExpress' or similar suffix)
  const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);

  const rawTitle =
    ogTitleMatch?.[1]?.trim() ??
    titleTagMatch?.[1]?.replace(/\s*[-|–]\s*AliExpress.*$/i, "").trim();

  if (!rawTitle || rawTitle.length < 5) return null;

  const price = extractPriceFromHtml(html);

  return {
    title: decodeHtmlEntities(rawTitle),
    imageUrl: ogImageMatch?.[1]?.trim() ?? null,
    priceUsd: price,
  };
}

/**
 * Verify the fetched HTML actually IS an AliExpress product page —
 * not a proxy's own homepage, a Cloudflare challenge, a 404, etc.
 *
 * Two-step check:
 *   1. HARD REJECT: known proxy/error markers in the first 5KB of HTML.
 *      If we see "CORSPROXY", "AllOrigins", Cloudflare challenge text,
 *      or generic "access denied" / "404" indicators, the response
 *      is definitely not the product we asked for.
 *   2. POSITIVE SIGNAL: must contain at least 2 AliExpress-specific
 *      markers (string "aliexpress" + product-page elements like
 *      "free shipping" / "buyer protection" / AE-specific CSS classes).
 *
 * If both checks pass we can safely run extraction. If either fails
 * we return null and the caller falls through to the next attempt.
 */
function looksLikeAliExpressPage(html: string): boolean {
  // Step 1: hard-reject known proxy/error pages
  const lowerSnippet = html.slice(0, 5000).toLowerCase();
  const rejectMarkers = [
    "corsproxy",
    "allorigins",
    "cors anywhere",
    "just a moment...", // Cloudflare challenge
    "checking your browser before accessing", // Cloudflare interstitial
    "error 1020", // Cloudflare access denied (banned IP)
    "error 1015", // Cloudflare rate limit
    "error 1006", // Cloudflare access denied (banned country)
    "error 1009",
    "<title>access denied</title>",
    "<title>403 forbidden</title>",
    "<title>404 not found</title>",
    "<title>page not found</title>",
  ];
  for (const marker of rejectMarkers) {
    if (lowerSnippet.includes(marker)) {
      console.warn(
        `[product-validator] page rejected — matched proxy/error marker: "${marker}"`,
      );
      return false;
    }
  }

  // Step 2: positive AE markers — need at least 2 of these to count
  const aeMarkers = [
    /aliexpress/i,
    /buyer protection|free shipping|store rating|ship from|sold by/i,
    /pdp-|fp-content|spm-anchor-id|sku-/i,
    /"productId"|"itemId"|"ae_item/i,
    /og:image[^>]*alicdn|og:image[^>]*aliexpress/i,
  ];
  let matches = 0;
  for (const re of aeMarkers) {
    if (re.test(html)) matches += 1;
  }
  if (matches < 2) {
    console.warn(
      `[product-validator] page rejected — only ${matches} AE markers matched (need 2+)`,
    );
    return false;
  }

  return true;
}

/**
 * Parse all JSON-LD blocks looking for a schema.org Product object.
 * AE wraps product data in this format for Google Shopping eligibility.
 */
function extractFromJsonLd(html: string): ScrapedProduct | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of blocks) {
    const jsonText = m[1].trim();
    try {
      const parsed = JSON.parse(jsonText);
      const products = collectJsonLdProducts(parsed);
      for (const p of products) {
        const name =
          typeof p.name === "string"
            ? p.name
            : Array.isArray(p.name) && typeof p.name[0] === "string"
              ? p.name[0]
              : null;
        if (!name || name.length < 5) continue;

        const image =
          typeof p.image === "string"
            ? p.image
            : Array.isArray(p.image) && typeof p.image[0] === "string"
              ? p.image[0]
              : typeof p.image === "object" && p.image && "url" in p.image
                ? (p.image as { url: string }).url
                : null;

        // Price — JSON-LD offers can be a single object or array
        let price = 0;
        const offers = p.offers;
        if (offers) {
          const first = Array.isArray(offers) ? offers[0] : offers;
          const priceVal =
            first?.price ?? first?.lowPrice ?? first?.priceSpecification?.price;
          if (priceVal != null) {
            const n = parseFloat(String(priceVal));
            if (isFinite(n) && n > 0 && n < 50_000) price = n;
          }
        }

        return {
          title: decodeHtmlEntities(name),
          imageUrl: image,
          priceUsd: price,
        };
      }
    } catch {
      // bad JSON in this block — try next
    }
  }
  return null;
}

interface JsonLdProduct {
  "@type"?: string | string[];
  name?: string | string[];
  image?: string | string[] | { url: string };
  offers?:
    | { price?: string | number; lowPrice?: string | number; priceSpecification?: { price?: string | number } }
    | Array<{ price?: string | number; lowPrice?: string | number; priceSpecification?: { price?: string | number } }>;
}

/**
 * JSON-LD blocks can contain a single object, an array of objects, or a
 * @graph wrapper. Walks the structure and yields anything that's a
 * Product or could be one.
 */
function collectJsonLdProducts(node: unknown): JsonLdProduct[] {
  const out: JsonLdProduct[] = [];
  function walk(n: unknown): void {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    const obj = n as JsonLdProduct & { "@graph"?: unknown };
    const type = obj["@type"];
    const isProduct =
      type === "Product" ||
      (Array.isArray(type) && type.includes("Product"));
    if (isProduct && obj.name) out.push(obj);
    // Some pages nest products under @graph
    if (obj["@graph"]) walk(obj["@graph"]);
  }
  walk(node);
  return out;
}

/**
 * Extract price from any of AE's known embedded-JSON patterns. The
 * pattern varies by AE page version + storefront, so we try several.
 */
function extractPriceFromHtml(html: string): number {
  const priceMatch =
    html.match(/"salePrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/) ??
    html.match(/"appSalePrice"\s*:[^{]*"value"\s*:\s*"?([0-9]+\.?[0-9]*)/) ??
    html.match(/"app_sale_price"\s*:\s*"([0-9]+\.?[0-9]*)"/) ??
    html.match(/"targetSalePrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/) ??
    html.match(/"actMinPrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/) ??
    html.match(/"minActivityAmount"\s*:[^{]*"value"\s*:\s*"?([0-9]+\.?[0-9]*)/);

  if (!priceMatch) return 0;
  const price = parseFloat(priceMatch[1]);
  return isFinite(price) && price > 0 && price < 50_000 ? price : 0;
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
