/**
 * Reverse Hunt — Play 2.
 *
 * Pipeline: paste an AliExpress product URL → fetch product details →
 * search Etsy for matching listings → score "will it sell".
 *
 * Output: { aliProduct, etsyDemand, verdict, estimatedMargin }
 *
 * Data source priority (May 16 2026):
 *   1. AliExpress DS API (works for .com global catalog)
 *   2. HTML scrape fallback (works for .us regional catalog, where
 *      the global DS API returns empty)
 */

import {
  getProductById,
  extractProductId,
  type AliExpressProduct,
} from "./aliexpress-api.service";
import {
  searchActiveListingsWithCount,
  type EtsyListing,
} from "./etsy-api.service";
import { extractSearchContext, createCostAccumulator } from "./anthropic.service";
import { calculateEtsyPrice } from "@/lib/etsy-price-calculator";

export type ReverseHuntVerdict = "STRONG_YES" | "YES" | "MAYBE" | "NO";

export interface EtsyDemandSnapshot {
  searchKeyword: string;
  totalListings: number;
  avgTopPrice: number;
  avgTopFavorites: number;
  topListings: Array<{
    title: string;
    price: number;
    favorites: number;
    listingId: number;
    url?: string;
  }>;
}

export interface ReverseHuntResponse {
  aliProduct: AliExpressProduct;
  etsyDemand: EtsyDemandSnapshot;
  verdict: ReverseHuntVerdict;
  verdictLabel: string;
  reasons: string[];
  recommendedEtsyPrice: number;
  estimatedMarginUsd: number;
  estimatedMarginPct: number;
  totalCostUsd: number;
  durationMs: number;
}

const VERDICT_LABELS: Record<ReverseHuntVerdict, string> = {
  STRONG_YES: "Strong yes — source this",
  YES: "Yes — worth listing",
  MAYBE: "Maybe — thin margins",
  NO: "Skip — won't sell",
};

/** Manual product info — used when auto-fetch isn't available (e.g.
 * .us regional URLs that Cloudflare blocks). User supplies title +
 * price by hand and the rest of the pipeline runs as normal. */
export interface ReverseHuntManualInput {
  title: string;
  priceUsd: number;
  imageUrl?: string | null;
  productUrl?: string | null;
}

/** Input modes for reverseHunt — exactly one must be present. */
export interface ReverseHuntInput {
  /** AE URL or numeric product ID. */
  input?: string;
  /** Manually-entered product data. */
  manualProduct?: ReverseHuntManualInput;
}

/**
 * Score on the same dimensions as Product Hunter:
 *   - Demand (Etsy listing count + avg favorites)
 *   - Margin (Etsy retail vs AliExpress cost vs Etsy fees)
 *
 * Returns the verdict + the dollar/percent margin so the team can
 * make a sourcing decision in under 10 seconds.
 */
export async function reverseHunt(
  input: ReverseHuntInput,
  accessToken: string,
): Promise<ReverseHuntResponse> {
  const startedAt = Date.now();
  const accum = createCostAccumulator();

  let aliProduct: AliExpressProduct;

  if (input.manualProduct) {
    // Manual entry path — skip all AE fetching. User has supplied
    // title + price directly (typically for .us URLs where the auto-
    // fetch path can't get through).
    const m = input.manualProduct;
    aliProduct = {
      productId: 0,
      title: m.title.trim(),
      imageUrl: m.imageUrl?.trim() || undefined,
      productUrl: m.productUrl?.trim() || undefined,
      priceMin: m.priceUsd,
      priceMax: m.priceUsd,
      currency: "USD",
    };
    console.log(
      `[reverse-hunt] manual mode — "${aliProduct.title.slice(0, 60)}" @ $${aliProduct.priceMin}`,
    );
  } else if (input.input) {
    // URL / product ID path — try DS API, then HTML scrape fallback
    const aliUrlOrId = input.input;
    const trimmed = aliUrlOrId.trim();
    const productId =
      /^\d+$/.test(trimmed) ? trimmed : extractProductId(aliUrlOrId);
    if (!productId) {
      throw new Error("Couldn't extract product ID from that URL.");
    }

    // Detect aliexpress.us / aliexpress.ru / other regional
    // storefronts — their product IDs (typically starting with
    // "3256") belong to separate regional catalogs that the global
    // DS API doesn't always serve. The call still "succeeds" but
    // returns an empty product (no title, no price), which then
    // produces nonsense downstream (a $0 cost product with random
    // Etsy search results).
    //
    // The .com and .us product ID prefixes:
    //   - aliexpress.com IDs typically start with "1005" (16 digits)
    //   - aliexpress.us IDs typically start with "3256" (16 digits)
    const isUsRegionalId = productId.startsWith("3256");
    const isUsRegionalUrl = /aliexpress\.(us|ru|fr|de|es|it|pl)/i.test(
      aliUrlOrId,
    );

    // Step 1: fetch AliExpress product via DS API
    let fetched = await getProductById(productId, { accessToken });

    // Validate the DS-API response actually contains real product data.
    // The DS API returns a "successful" empty response for products
    // outside its catalog (e.g. aliexpress.us regional IDs) — without
    // this check we'd run the rest of the pipeline on $0 cost + empty
    // title and produce nonsense Etsy results.
    const dsHasData =
      fetched &&
      fetched.title &&
      fetched.title.trim().length > 0 &&
      fetched.priceMin &&
      fetched.priceMin > 0;

    // DS API returned empty (common for .us regional URLs). Try the
    // HTML scrape fallback — fetch the product page directly and
    // extract title/image/price from meta tags + embedded JSON.
    // Only attempt when input is a URL (not a bare numeric ID, since
    // we don't know which storefront to scrape from).
    if (!dsHasData && /^https?:\/\//i.test(aliUrlOrId.trim())) {
      console.log(
        `[reverse-hunt] DS API empty for ${productId} — trying HTML scrape (likely .us URL)`,
      );
      const scraped = await fetchAeProductFromHtml(aliUrlOrId.trim());
      if (scraped) fetched = scraped;
    }

    // Final validation — if neither path got real data, fail cleanly
    // with a message that points the user to the manual entry option.
    const titleOk = fetched?.title && fetched.title.trim().length > 0;
    const priceOk = fetched?.priceMin && fetched.priceMin > 0;
    if (!fetched || !titleOk || !priceOk) {
      if (isUsRegionalId || isUsRegionalUrl) {
        throw new Error(
          "Couldn't auto-load this aliexpress.us product (page is blocked or JS-rendered). Switch to manual mode and paste the title + price by hand — the rest of the verdict will still run.",
        );
      }
      throw new Error(
        "AliExpress returned no usable data for this product — switch to manual mode and paste the title + price by hand.",
      );
    }
    aliProduct = fetched;
  } else {
    throw new Error(
      "Either an AE URL/ID or manual product info is required.",
    );
  }

  // Step 2: Haiku extracts a search-friendly keyword from the AliExpress title
  // (AliExpress titles are usually keyword-stuffed garbage)
  const ctx = await extractSearchContext(aliProduct.title, accum);
  const searchKeyword = ctx.searchKeyword || aliProduct.title.split(" ").slice(0, 4).join(" ");

  // Step 3: Etsy demand check
  const { totalListings, results: etsyResults } =
    await searchActiveListingsWithCount(searchKeyword, 10, "score");

  const etsyPrices = etsyResults
    .map((r: EtsyListing) => Number(r.price?.amount ?? 0) / 100)
    .filter((p) => p > 0);
  const avgTopPrice =
    etsyPrices.length > 0
      ? etsyPrices.reduce((s, p) => s + p, 0) / etsyPrices.length
      : 0;
  const avgTopFavorites =
    etsyResults.length > 0
      ? etsyResults.reduce((s, r) => s + (r.num_favorers ?? 0), 0) /
        etsyResults.length
      : 0;

  // Step 4: margin math — use the team's existing markup table.
  // Formula: matured = (ali + markup) / 0.425, so seller net after Etsy
  // fees = matured × 0.425 = ali + markup, which means PROFIT = markup.
  // That's the whole point of the stepped-markup table.
  const aliCost = aliProduct.priceMin;
  const pricing = calculateEtsyPrice(aliCost);
  const recommendedEtsyPrice = pricing.etsyMatured;
  const estimatedMarginUsd = pricing.markup;
  const estimatedMarginPct =
    recommendedEtsyPrice > 0
      ? (estimatedMarginUsd / recommendedEtsyPrice) * 100
      : 0;

  // Step 5: verdict
  const reasons: string[] = [];
  let verdict: ReverseHuntVerdict = "MAYBE";

  // Demand bucket
  let demandScore = 0;
  if (totalListings >= 100 && totalListings <= 5000) {
    demandScore = 3;
    reasons.push(
      `Healthy demand — ${totalListings.toLocaleString()} Etsy listings means buyers actively search this.`,
    );
  } else if (totalListings > 5000) {
    demandScore = 1;
    reasons.push(
      `Saturated — ${totalListings.toLocaleString()} Etsy listings, harder to rank.`,
    );
  } else if (totalListings >= 30) {
    demandScore = 2;
    reasons.push(
      `Niche market — ${totalListings.toLocaleString()} listings, low competition.`,
    );
  } else {
    demandScore = 0;
    reasons.push(
      `Very thin — only ${totalListings} Etsy listings exist for this keyword.`,
    );
  }

  // Engagement bucket
  let engagementScore = 0;
  if (avgTopFavorites >= 100) {
    engagementScore = 3;
    reasons.push(
      `Strong buyer interest — avg ${Math.round(avgTopFavorites)} favorites in top results.`,
    );
  } else if (avgTopFavorites >= 30) {
    engagementScore = 2;
    reasons.push(
      `Moderate interest — avg ${Math.round(avgTopFavorites)} favorites.`,
    );
  } else {
    reasons.push(
      `Weak buyer signal — top listings have only ${Math.round(avgTopFavorites)} favorites avg.`,
    );
  }

  // Margin bucket
  let marginScore = 0;
  if (estimatedMarginUsd >= 12) {
    marginScore = 3;
    reasons.push(
      `Excellent margin — projected $${estimatedMarginUsd.toFixed(2)} profit per sale (${estimatedMarginPct.toFixed(0)}%).`,
    );
  } else if (estimatedMarginUsd >= 7) {
    marginScore = 2;
    reasons.push(
      `Decent margin — $${estimatedMarginUsd.toFixed(2)}/sale (${estimatedMarginPct.toFixed(0)}%).`,
    );
  } else if (estimatedMarginUsd >= 3) {
    marginScore = 1;
    reasons.push(
      `Thin margin — only $${estimatedMarginUsd.toFixed(2)}/sale. Volume needed.`,
    );
  } else {
    marginScore = 0;
    reasons.push(
      `Margin too thin — $${estimatedMarginUsd.toFixed(2)}/sale is not worth the time.`,
    );
  }

  const totalScore = demandScore + engagementScore + marginScore;
  if (totalScore >= 8) verdict = "STRONG_YES";
  else if (totalScore >= 6) verdict = "YES";
  else if (totalScore >= 3) verdict = "MAYBE";
  else verdict = "NO";

  return {
    aliProduct,
    etsyDemand: {
      searchKeyword,
      totalListings,
      avgTopPrice,
      avgTopFavorites,
      topListings: etsyResults.slice(0, 5).map((l: EtsyListing) => ({
        title: l.title,
        price: Number(l.price?.amount ?? 0) / 100,
        favorites: l.num_favorers ?? 0,
        listingId: l.listing_id,
        url: l.url,
      })),
    },
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    reasons,
    recommendedEtsyPrice,
    estimatedMarginUsd,
    estimatedMarginPct,
    totalCostUsd: accum.totalCostUsd,
    durationMs: Date.now() - startedAt,
  };
}

// ─── HTML scrape fallback (for aliexpress.us regional catalog) ──────
//
// The global DS API doesn't serve the .us regional catalog. For those
// URLs we fetch the product page HTML directly and extract title +
// image + price from the embedded meta tags + JSON.
//
// AE product pages reliably ship the following in the initial HTML
// (i.e. before JS execution), which is what we need to parse:
//   - <meta property="og:title" content="...">
//   - <meta property="og:image" content="...">
//   - embedded JSON with "salePrice" / "appSalePrice" / "targetSalePrice"
//
// Scraping is best-effort — returns null on any failure (HTTP error,
// missing fields, Cloudflare challenge, etc.) and the caller falls
// through to the friendly "couldn't load" error.

const SCRAPE_TIMEOUT_MS = 10_000;

async function fetchAeProductFromHtml(
  productUrl: string,
): Promise<AliExpressProduct | null> {
  const startedAt = Date.now();
  let html: string;
  try {
    const res = await fetch(productUrl, {
      headers: {
        // Look like a real browser so AE doesn't serve a stripped
        // bot variant of the page.
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
        `[reverse-hunt] HTML scrape: HTTP ${res.status} in ${Date.now() - startedAt}ms`,
      );
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.warn(
      `[reverse-hunt] HTML scrape failed:`,
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
  const imageUrl = html
    .match(
      /<meta[^>]+(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    )?.[1]
    ?.trim();

  // Price — AE embeds in __INIT_DATA__ / window.runParams JSON. Try
  // several known shapes in order of likelihood.
  const priceMatch =
    html.match(/"salePrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/) ??
    html.match(/"appSalePrice"\s*:[^{]*"value"\s*:\s*"?([0-9]+\.?[0-9]*)/) ??
    html.match(/"app_sale_price"\s*:\s*"([0-9]+\.?[0-9]*)"/) ??
    html.match(/"targetSalePrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/) ??
    html.match(/"actMinPrice"\s*:\s*"?([0-9]+\.?[0-9]*)"?/);

  if (!titleRaw) {
    console.warn(`[reverse-hunt] HTML scrape: no og:title found`);
    return null;
  }
  if (!priceMatch) {
    console.warn(`[reverse-hunt] HTML scrape: no price pattern matched`);
    return null;
  }

  const price = parseFloat(priceMatch[1]);
  if (!isFinite(price) || price <= 0 || price > 10000) {
    console.warn(
      `[reverse-hunt] HTML scrape: invalid price "${priceMatch[1]}"`,
    );
    return null;
  }

  // Numeric product ID from the URL path
  const productIdMatch = productUrl.match(/\/item\/(\d+)/);
  const productId = productIdMatch ? Number(productIdMatch[1]) : 0;

  const title = decodeHtmlEntities(titleRaw);
  console.log(
    `[reverse-hunt] HTML scrape success in ${Date.now() - startedAt}ms — "${title.slice(0, 60)}" @ $${price}`,
  );

  return {
    productId,
    title,
    imageUrl,
    productUrl,
    priceMin: price,
    priceMax: price,
    currency: "USD",
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
