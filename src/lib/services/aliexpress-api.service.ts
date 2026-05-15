import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * AliExpress Open Platform — Drop Shipping (DS) API client.
 *
 * Wraps the v1 "sync" endpoint with HMAC-SHA256 signing + OAuth token
 * management. Mirrors the Etsy service pattern (single client, all
 * endpoints in one file) so future maintainers find everything in
 * one place.
 *
 * Verified working May 15 2026 against `aliexpress.ds.category.get`
 * (returned 559 categories) using a sandbox loaner account.
 *
 * Env vars (Vercel):
 *   ALIEXPRESS_APP_KEY     — public-ish app key (we saw "534330")
 *   ALIEXPRESS_APP_SECRET  — shared secret for HMAC signing
 *
 * Registered callback URL: https://portal.meta7.media/api/aliexpress/callback
 */

const API_BASE = "https://api-sg.aliexpress.com/sync";
// AliExpress OAuth authorize page. After approval, AliExpress redirects
// to our registered callback URL with `?code=XXX&state=YYY`.
const OAUTH_AUTHORIZE_URL = "https://api-sg.aliexpress.com/oauth/authorize";
// Token exchange + refresh both go through the SAME `/sync` endpoint
// as regular API calls. The "endpoint" is just a different `method` param
// with /auth/token/security/create or /auth/token/security/refresh.
const OAUTH_TOKEN_METHOD = "/auth/token/security/create";
const OAUTH_REFRESH_METHOD = "/auth/token/security/refresh";

const APP_KEY = process.env.ALIEXPRESS_APP_KEY ?? "";
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET ?? "";
const CALLBACK_URL = "https://portal.meta7.media/api/aliexpress/callback";

if (!APP_KEY || !APP_SECRET) {
  // Don't throw at import time — let API routes return a clean 503
  // when actually called. Otherwise the build breaks in CI before envs
  // are wired up.
  console.warn(
    "[aliexpress] ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET not set.",
  );
}

// ─── Types ──────────────────────────────────────────────────────────

export interface AliExpressProduct {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceMin: number;
  priceMax: number;
  currency: string;
  rating?: number;
  orderCount?: number;
  shopId?: number;
  shopName?: string;
  shipsFrom?: string;
}

export interface ProductSearchResponse {
  totalResults: number;
  products: AliExpressProduct[];
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  // AliExpress returns either seconds (`expires_in`) OR an absolute
  // ms epoch (`expire_time`). The callback handles both.
  expires_in?: number;
  expire_time?: number;
  refresh_expires_in?: number;
  refresh_token_valid_time?: number;
  user_id?: string;
  user_nick?: string;
  account_platform?: string;
}

/**
 * Resolve the absolute access-token expiry from the variable shapes
 * AliExpress uses (`expires_in` seconds vs `expire_time` ms epoch).
 * Falls back to a 30-day window if AliExpress sends neither.
 */
export function resolveAccessExpiry(token: OAuthTokenResponse): Date {
  if (typeof token.expire_time === "number" && token.expire_time > Date.now()) {
    return new Date(token.expire_time);
  }
  if (typeof token.expires_in === "number" && token.expires_in > 0) {
    return new Date(Date.now() + token.expires_in * 1000);
  }
  // Conservative fallback — AliExpress access tokens last ~1 year by default
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * Same logic for refresh-token expiry.
 */
export function resolveRefreshExpiry(token: OAuthTokenResponse): Date | null {
  if (
    typeof token.refresh_token_valid_time === "number" &&
    token.refresh_token_valid_time > Date.now()
  ) {
    return new Date(token.refresh_token_valid_time);
  }
  if (
    typeof token.refresh_expires_in === "number" &&
    token.refresh_expires_in > 0
  ) {
    return new Date(Date.now() + token.refresh_expires_in * 1000);
  }
  return null;
}

// ─── Signing ────────────────────────────────────────────────────────

/**
 * AliExpress v1 sign algorithm — HMAC-SHA256 (newer apps) over sorted
 * params concatenated as `key1value1key2value2...`. Returned uppercase hex.
 *
 * The `sign` itself is NEVER included in the input. `sign_method`
 * (e.g. "sha256") IS included.
 */
function signRequest(params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== "")
    .sort();
  const concat = sorted.map((k) => `${k}${params[k]}`).join("");
  return crypto
    .createHmac("sha256", APP_SECRET)
    .update(concat, "utf8")
    .digest("hex")
    .toUpperCase();
}

// ─── Token bucket (10 QPS with burst of 10) ─────────────────────────
//
// AliExpress Personal Access tier docs say 5 QPS / 5K QPD. The CEO
// explicitly approved aggressive concurrency over conservatism, so
// we sustain 10 QPS with a 10-call initial burst.
//
// Math for a 48-keyword niche hunt (worst case where every keyword
// also needs the secondary text.search fallback = 96 tokens):
//   - First 10 calls: instant at t=0
//   - Remaining 86 at 1 per 100ms = 8.6s
//   - Plus HTTP per-call: ~1.5s
//   - Plus optional category-name fallback for zero-result keywords
//   - Last call completes at ~10-12s, well under the 20s timeout
//
// 429s from AE bursts are tolerated by our retry path (acquireSlot
// lives OUTSIDE the retry loop, so retries don't re-queue).

let bucketTokens = 10;
let lastRefillAt = Date.now();
const BUCKET_CAP = 10;
const REFILL_MS = 100;

async function acquireSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    const elapsed = now - lastRefillAt;
    if (elapsed > 0) {
      const refill = Math.floor(elapsed / REFILL_MS);
      if (refill > 0) {
        bucketTokens = Math.min(BUCKET_CAP, bucketTokens + refill);
        lastRefillAt = now - (elapsed % REFILL_MS);
      }
    }
    if (bucketTokens > 0) {
      bucketTokens -= 1;
      return;
    }
    await new Promise((r) => setTimeout(r, REFILL_MS));
  }
}

// ─── Core sync call ─────────────────────────────────────────────────

/**
 * Call any AliExpress `aliexpress.xxx.yyy` method.
 *
 * Caller passes the method-specific params; we add app_key, timestamp,
 * sign_method, sign automatically. If `accessToken` is given, it goes
 * in as `session`.
 *
 * Retries on transient failures (429, 5xx) up to 4 attempts with
 * exponential backoff (800ms → 1.6s → 3.2s → 6.4s).
 */
export async function aliExpressCall<T = unknown>(
  method: string,
  params: Record<string, string | number | boolean> = {},
  accessToken?: string,
): Promise<T> {
  if (!APP_KEY || !APP_SECRET) {
    throw new Error("AliExpress credentials not configured");
  }

  const stringifiedParams: Record<string, string> = {
    method,
    app_key: APP_KEY,
    sign_method: "sha256",
    timestamp: String(Date.now()),
  };
  if (accessToken) stringifiedParams.session = accessToken;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      stringifiedParams[k] = String(v);
    }
  }
  stringifiedParams.sign = signRequest(stringifiedParams);

  const url = `${API_BASE}?${new URLSearchParams(stringifiedParams).toString()}`;

  // Reduced from 4 → 2 attempts with halved backoff. The original
  // 4-attempt × 800ms-base backoff could waste up to 12s per failing
  // call. With many parallel calls (~40 AE during a Manual Hunting
  // hunt), retry storms compounded into 60s+ wall times.
  //
  // IMPORTANT: acquireSlot lives OUTSIDE the retry loop. Each logical
  // call consumes exactly ONE token, so retries don't re-queue
  // through the rate limiter. When acquireSlot was inside the loop,
  // a few % of calls hitting 429 would compound — 40 calls + a
  // dozen retries pushed effective queue depth to 50+ tokens, which
  // is what was making the last categories' previews time out
  // before they ever fetched.
  await acquireSlot();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`AliExpress ${res.status}`);
          await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(
          `AliExpress ${method} failed: ${res.status} ${await res.text()}`,
        );
      }
      const json = await res.json();
      // AliExpress wraps errors in multiple inconsistent shapes.
      // We catch all of them so failures bubble up as clear toasts
      // instead of silently returning "0 results".

      // Shape 1: { error_response: { code, msg, sub_msg } }
      if (json?.error_response) {
        const err = json.error_response;
        console.error(
          `[aliexpress] ${method} error_response:`,
          JSON.stringify(err).slice(0, 400),
        );
        throw new Error(
          `AliExpress error ${err.code}: ${err.sub_msg ?? err.msg ?? "unknown"}`,
        );
      }

      // Shape 2: Permission denial — flat { code: "InsufficientPermission",
      // message: "...", bizSuccess: false }. AliExpress returns this for
      // /solution/ namespace failures, NOT wrapped in error_response.
      if (
        json?.code === "InsufficientPermission" ||
        (json?.bizSuccess === false && typeof json?.message === "string")
      ) {
        console.error(
          `[aliexpress] ${method} access denied:`,
          JSON.stringify({
            code: json.code,
            message: json.message,
            shortCode: json.shortCode,
          }).slice(0, 300),
        );
        throw new Error(
          json.code === "InsufficientPermission"
            ? `Permission missing for ${method} — apply via AliExpress console → Process apply`
            : `AliExpress error: ${json.message}`,
        );
      }

      // Shape 3: Token/auth failure — e.g. expired session
      if (
        json?.code === "InvalidAccessToken" ||
        json?.code === "AccessTokenExpired"
      ) {
        console.error(`[aliexpress] ${method} token invalid:`, json);
        throw new Error(
          `AliExpress token invalid (${json.code}) — reconnect on Product Hunter`,
        );
      }

      // Success — log full response (truncated) so we can debug parser
      // mismatches without trial-and-error. This is verbose but cheap
      // and 90% of debugging time comes from missing response shapes.
      const bodyPreview = JSON.stringify(json).slice(0, 2000);
      console.log(
        `[aliexpress] ${method} ok — keys: [${Object.keys(json).join(", ")}] — body: ${bodyPreview}`,
      );
      return json as T;
    } catch (err) {
      lastErr = err;
      if (attempt === 1) break;
      await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`AliExpress ${method} failed after retries`);
}

// ─── OAuth helpers ──────────────────────────────────────────────────

/**
 * Build the URL the user visits to start the OAuth dance.
 * After they approve, AliExpress redirects to CALLBACK_URL with `?code=XXX`.
 */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    redirect_uri: CALLBACK_URL,
    client_id: APP_KEY,
    state,
  });
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Pull the access_token bundle out of an AliExpress sync response.
 *
 * AliExpress wraps token responses in either:
 *   { auth_token_security_create_response: { access_token, ... } }
 *   { auth_token_security_refresh_response: { access_token, ... } }
 *   { access_token: ..., refresh_token: ... }   (unwrapped, rare)
 *
 * Returns the inner object or throws if not present.
 */
function unwrapTokenResponse(raw: unknown): OAuthTokenResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("Empty token response");
  }
  const root = raw as Record<string, unknown>;

  // Already unwrapped
  if (typeof root.access_token === "string") {
    return root as unknown as OAuthTokenResponse;
  }

  // Find any *_response wrapper
  for (const key of Object.keys(root)) {
    if (key.endsWith("_response") && root[key] && typeof root[key] === "object") {
      const inner = root[key] as Record<string, unknown>;
      if (typeof inner.access_token === "string") {
        return inner as unknown as OAuthTokenResponse;
      }
    }
  }

  throw new Error(
    `Token response missing access_token: ${JSON.stringify(raw).slice(0, 300)}`,
  );
}

/**
 * Exchange the `code` from the OAuth callback for an access token +
 * refresh token. Goes through the SAME `/sync` endpoint as every other
 * AliExpress API call — the only difference is the `method` param
 * (and no `session` since we're creating the session).
 *
 * Verified shape: signed HMAC-SHA256, POST to /sync, params as query string.
 */
export async function exchangeCodeForToken(
  code: string,
): Promise<OAuthTokenResponse> {
  if (!APP_KEY || !APP_SECRET) {
    throw new Error("AliExpress credentials not configured");
  }

  const params: Record<string, string> = {
    method: OAUTH_TOKEN_METHOD,
    app_key: APP_KEY,
    code,
    sign_method: "sha256",
    timestamp: String(Date.now()),
  };
  params.sign = signRequest(params);

  const url = `${API_BASE}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { method: "POST" });
  const text = await res.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Token exchange returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`,
    );
  }

  // AliExpress wraps errors in error_response
  const root = json as Record<string, unknown>;
  if (root.error_response) {
    const err = root.error_response as Record<string, unknown>;
    throw new Error(
      `AliExpress token error ${err.code ?? "?"}: ${err.sub_msg ?? err.msg ?? JSON.stringify(err)}`,
    );
  }

  return unwrapTokenResponse(json);
}

/**
 * Refresh a near-expiry access token. Same /sync endpoint, different method.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  if (!APP_KEY || !APP_SECRET) {
    throw new Error("AliExpress credentials not configured");
  }

  const params: Record<string, string> = {
    method: OAUTH_REFRESH_METHOD,
    app_key: APP_KEY,
    refresh_token: refreshToken,
    sign_method: "sha256",
    timestamp: String(Date.now()),
  };
  params.sign = signRequest(params);

  const url = `${API_BASE}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { method: "POST" });
  const text = await res.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Token refresh returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const root = json as Record<string, unknown>;
  if (root.error_response) {
    const err = root.error_response as Record<string, unknown>;
    throw new Error(
      `AliExpress refresh error ${err.code ?? "?"}: ${err.sub_msg ?? err.msg ?? JSON.stringify(err)}`,
    );
  }

  return unwrapTokenResponse(json);
}

/**
 * Load the active (non-expired or auto-refreshable) AliExpress token
 * for a user. Refreshes opportunistically if within 24h of expiry.
 *
 * Returns null if no token exists (caller should redirect to auth-start).
 */
export async function getActiveTokenForUser(
  userId: string,
): Promise<string | null> {
  const token = await prisma.aliExpressToken.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!token) return null;

  const oneDay = 24 * 60 * 60 * 1000;
  const expiresAtMs = token.expiresAt.getTime();
  const now = Date.now();

  // Still has more than 24h left — use as-is
  if (expiresAtMs - now > oneDay) {
    return token.accessToken;
  }

  // Within 24h of expiry — refresh
  try {
    const fresh = await refreshAccessToken(token.refreshToken);
    const newExpiresAt = resolveAccessExpiry(fresh);
    const newRefreshExpiresAt = resolveRefreshExpiry(fresh);
    await prisma.aliExpressToken.update({
      where: { id: token.id },
      data: {
        accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token,
        expiresAt: newExpiresAt,
        refreshExpiresAt: newRefreshExpiresAt,
      },
    });
    return fresh.access_token;
  } catch (err) {
    // Refresh failed — if still in the valid window, use the existing
    // token and let the next call surface the auth error.
    if (expiresAtMs > now) return token.accessToken;
    console.error("[aliexpress] refresh failed, no fallback:", err);
    return null;
  }
}

// ─── Endpoint wrappers ──────────────────────────────────────────────

/**
 * Search AliExpress for products by keyword.
 * Used by Play 1 (full-loop Product Hunter) + Play 3 (daily auto-hunt).
 *
 * Tries methods in this order (some require permissions we may or may
 * not have; we accept the first that returns products):
 *   1. aliexpress.ds.text.search       — DS keyword search
 *   2. aliexpress.affiliate.product.query — Affiliate search (works for many apps)
 *   3. aliexpress.ds.recommend.feed.get — Feed-based recommendations
 */
export async function searchProductsByKeyword(
  keyword: string,
  options: {
    accessToken: string;
    pageSize?: number;
    pageNo?: number;
    sortBy?: "orders_desc" | "rating_desc" | "price_asc" | "price_desc";
    minPrice?: number;
    maxPrice?: number;
    targetCurrency?: string;
    targetLanguage?: string;
  },
): Promise<ProductSearchResponse> {
  // Send every plausible param-name variant — different methods use
  // different naming conventions, but AliExpress ignores unknown params
  // so the shotgun approach is safe.
  const baseParams: Record<string, string | number> = {
    keywords: keyword,
    keyWord: keyword,
    keyword: keyword,
    q: keyword,
    local: "en_US",
    locale: "en_US",
    country: "US",
    countryCode: "US",
    target_currency: options.targetCurrency ?? "USD",
    target_language: "en",
    currency: options.targetCurrency ?? "USD",
    ship_to_country: "US",
    page_size: options.pageSize ?? 20,
    pageSize: options.pageSize ?? 20,
    page_no: options.pageNo ?? 1,
    pageNo: options.pageNo ?? 1,
    // Recommend-feed wants a feed_name — "DS_TextSearch" is the
    // documented one for keyword-based recommendations
    feed_name: "DS_TextSearch",
  };
  if (options.sortBy) {
    baseParams.sortBy = options.sortBy;
    baseParams.sort = options.sortBy;
  }
  if (options.minPrice !== undefined) {
    baseParams.minPrice = options.minPrice;
    baseParams.min_sale_price = options.minPrice;
  }
  if (options.maxPrice !== undefined) {
    baseParams.maxPrice = options.maxPrice;
    baseParams.max_sale_price = options.maxPrice;
  }

  // Drop Shipping app type only has access to the `aliexpress.ds.*`
  // namespace. `aliexpress.affiliate.product.query` was historically in
  // this list as a "long shot" fallback — it has ALWAYS returned 403
  // InsufficientPermission for our app, so every call to it was a
  // wasted token + HTTP roundtrip. With ~30% of niche-hunt keywords
  // falling through to the third method (because earlier methods
  // return 0 products for niche-tail queries), this was burning ~14
  // wasted tokens per hunt and pushing the last keywords' fetches
  // past their 20s timeout. Removed.
  const methodsToTry = [
    "aliexpress.ds.text.search", // Primary — DS keyword search
    "aliexpress.ds.recommend.feed.get", // Secondary — feed-based, sometimes helps
  ];

  let lastResponse: Record<string, unknown> | null = null;
  const errors: string[] = [];
  for (const method of methodsToTry) {
    try {
      const raw = await aliExpressCall<Record<string, unknown>>(
        method,
        baseParams,
        options.accessToken,
      );
      lastResponse = raw;
      const parsed = parseProductSearch(raw);
      if (parsed.products.length > 0) {
        console.log(
          `[aliexpress] search via ${method} returned ${parsed.products.length} products`,
        );
        return parsed;
      }
      console.log(
        `[aliexpress] ${method} returned 0 products — trying next method. Raw keys: ${Object.keys(raw).join(", ")}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${method}: ${msg}`);
      console.warn(`[aliexpress] ${method} threw: ${msg}`);
    }
  }

  // Everything returned empty/failed — if every attempt threw, surface
  // the first error so the user sees the real reason (e.g. "Permission
  // missing — apply via AliExpress console"). Otherwise, dump the last
  // response and return empty.
  if (errors.length === methodsToTry.length && errors.length > 0) {
    throw new Error(errors[0]);
  }
  if (lastResponse) {
    console.error(
      `[aliexpress] ALL search methods returned 0. Last raw response: ${JSON.stringify(lastResponse).slice(0, 1500)}`,
    );
  }
  return { totalResults: 0, products: [] };
}

/**
 * Fetch a single product by ID. Used by Play 2 (reverse hunt) +
 * Play 5 (margin calc).
 */
export async function getProductById(
  productId: string | number,
  options: { accessToken: string; targetCurrency?: string },
): Promise<AliExpressProduct | null> {
  try {
    const raw = await aliExpressCall<Record<string, unknown>>(
      "aliexpress.ds.product.get",
      {
        product_id: productId,
        target_currency: options.targetCurrency ?? "USD",
        target_language: "en",
        ship_to_country: "US",
      },
      options.accessToken,
    );
    return parseSingleProduct(raw);
  } catch (err) {
    console.error("[aliexpress] product.get failed:", err);
    return null;
  }
}

/**
 * Image search — Play 4. Accepts a public image URL (or pre-uploaded
 * AliExpress image_id). Returns top similar products.
 *
 * `aliexpress.ds.image.search` is the documented method.
 */
export async function searchProductsByImage(
  imageUrl: string,
  options: {
    accessToken: string;
    pageSize?: number;
  },
): Promise<ProductSearchResponse> {
  const raw = await aliExpressCall<Record<string, unknown>>(
    "aliexpress.ds.image.search",
    {
      imageUrl,
      pageSize: options.pageSize ?? 12,
      currency: "USD",
      local: "en_US",
      countryCode: "US",
    },
    options.accessToken,
  );
  return parseProductSearch(raw);
}

/**
 * Extract product ID from a typical AliExpress URL.
 *   https://www.aliexpress.us/item/3256805123456789.html  → "3256805123456789"
 *   https://www.aliexpress.com/item/1005006123456789.html → "1005006123456789"
 */
export function extractProductId(url: string): string | null {
  const match = url.match(/\/item\/(\d{10,20})(?:\.html|[\/?#]|$)/);
  if (match) return match[1];
  // Some URLs use _ prefix or different formats
  const fallback = url.match(/(\d{13,20})/);
  return fallback ? fallback[1] : null;
}

// ─── Response parsers ───────────────────────────────────────────────
// AliExpress returns deeply-nested + inconsistent shapes. These parsers
// normalize to our flat AliExpressProduct interface and tolerate
// missing fields gracefully.

interface RawProduct {
  // Various ID field names across DS / Affiliate / Solution responses
  product_id?: number | string;
  productId?: number | string;
  item_id?: number | string;
  itemId?: number | string;
  // Titles
  title?: string;
  product_title?: string;
  subject?: string;
  // Images
  product_main_image_url?: string;
  product_image_url?: string;
  image_url?: string;
  itemMainPic?: string;
  // URLs
  product_detail_url?: string;
  promotion_link?: string;
  itemUrl?: string;
  // Prices — many naming conventions
  target_sale_price?: string | number;
  target_app_sale_price?: string | number;
  app_sale_price?: string | number;
  sale_price?: string | number;
  original_price?: string | number;
  target_original_price?: string | number;
  targetSalePrice?: string | number;
  targetOriginalPrice?: string | number;
  salePrice?: string | number;
  originalPrice?: string | number;
  // Currency
  target_sale_price_currency?: string;
  targetSalePriceCurrency?: string;
  targetOriginalPriceCurrency?: string;
  salePriceCurrency?: string;
  // Rating / engagement
  evaluate_rate?: string | number;
  evaluateRate?: string | number;
  product_rating?: string | number;
  lastest_volume?: number;
  trade_count?: number;
  orders?: string | number;
  // Shop
  shop_id?: number;
  shopId?: number;
  shop_name?: string;
  shopName?: string;
  ship_from_country?: string;
}

function normalizeProduct(raw: RawProduct): AliExpressProduct {
  const productId = Number(
    raw.product_id ?? raw.productId ?? raw.item_id ?? raw.itemId ?? 0,
  );
  // Always prefer target_* prices — those are localized to our target
  // currency (USD). Without "target_" the price is in seller's home
  // currency (often CNY).
  const priceMin = Number(
    raw.target_app_sale_price ??
      raw.targetSalePrice ??
      raw.target_sale_price ??
      raw.app_sale_price ??
      raw.salePrice ??
      raw.sale_price ??
      0,
  );
  const priceMax = Number(
    raw.targetOriginalPrice ??
      raw.target_original_price ??
      raw.originalPrice ??
      raw.original_price ??
      priceMin,
  );

  // AliExpress itemUrl often comes as protocol-relative ("//www.aliexpress.com/...")
  // Normalize to https://
  let productUrl =
    raw.product_detail_url ?? raw.promotion_link ?? raw.itemUrl;
  if (productUrl?.startsWith("//")) productUrl = `https:${productUrl}`;

  return {
    productId,
    title: raw.title ?? raw.product_title ?? raw.subject ?? "",
    imageUrl:
      raw.product_main_image_url ??
      raw.product_image_url ??
      raw.image_url ??
      raw.itemMainPic,
    productUrl,
    priceMin,
    priceMax,
    // Currency: if target* fields are set we know it's been converted to
    // our target (USD via the search params). Otherwise fall back to
    // whatever currency the seller listed in.
    currency:
      raw.targetOriginalPriceCurrency === "USD" ||
      raw.targetSalePrice !== undefined ||
      raw.target_sale_price !== undefined
        ? "USD"
        : raw.target_sale_price_currency ??
          raw.salePriceCurrency ??
          "USD",
    rating: raw.evaluateRate
      ? Number(String(raw.evaluateRate).replace("%", ""))
      : raw.evaluate_rate
        ? Number(String(raw.evaluate_rate).replace("%", ""))
        : raw.product_rating
          ? Number(raw.product_rating)
          : undefined,
    orderCount:
      raw.lastest_volume ??
      raw.trade_count ??
      (typeof raw.orders === "string" && raw.orders
        ? Number(raw.orders.replace(/[^\d]/g, "")) || undefined
        : typeof raw.orders === "number"
          ? raw.orders
          : undefined),
    shopId: raw.shop_id ?? raw.shopId,
    shopName: raw.shop_name ?? raw.shopName,
    shipsFrom: raw.ship_from_country,
  };
}

function parseProductSearch(raw: unknown): ProductSearchResponse {
  // The wrapper key changes per method — drill until we find the data.
  const root = raw as Record<string, unknown>;
  const wrapper = findFirst(root, (k) => k.endsWith("_response"));
  const data = findFirst(wrapper ?? root, (k) => k === "data");
  const resp = findFirst(wrapper ?? root, (k) => k === "resp_result") ?? wrapper;
  const result = findFirst(resp ?? root, (k) => k === "result") ?? resp;

  let list: unknown[] = [];
  let total = 0;

  // Path 1 — aliexpress.ds.text.search shape:
  //   { aliexpress_ds_text_search_response: { code, data: {
  //       totalCount, products: { selection_search_product: [...] } } } }
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    total = Number(d.totalCount ?? d.total ?? d.total_record_count ?? 0);
    const productsContainer = d.products as Record<string, unknown> | undefined;
    if (productsContainer && typeof productsContainer === "object") {
      list =
        extractArray(productsContainer.selection_search_product) ??
        extractArray(productsContainer.product) ??
        extractArray(productsContainer.item) ??
        extractArray(productsContainer.items) ??
        [];
    }
    if (list.length === 0) {
      list = extractArray(d.items) ?? extractArray(d.itemList) ?? [];
    }
  }

  // Path 2 — older "resp_result.result" shape (Affiliate-style)
  if (list.length === 0 && result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    total = Number(
      r.total_record_count ??
        r.totalRecord ??
        r.total_result_count ??
        r.totalCount ??
        r.total ??
        total,
    );
    list =
      extractArray(r.products) ??
      extractArray(r.product_list) ??
      extractArray(r.product) ??
      extractArray(r.items) ??
      extractArray(r.itemList) ??
      [];
  }

  // Path 3 — recursive walk as last-resort safety net
  if (list.length === 0) {
    const found = findProductArrayDeep(raw, 0);
    if (found) {
      list = found;
      if (total === 0) total = found.length;
    }
  }

  return {
    totalResults: total || list.length,
    products: list.map((p) => normalizeProduct(p as RawProduct)),
  };
}

/**
 * Recursively walk an object looking for any array whose first element
 * has product-shaped fields. Bounded depth so we don't blow the stack
 * on circular refs.
 */
function findProductArrayDeep(
  obj: unknown,
  depth: number,
): unknown[] | null {
  if (depth > 8 || !obj) return null;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return null;
    const first = obj[0];
    if (first && typeof first === "object") {
      const f = first as Record<string, unknown>;
      // Anything with a product-shaped identifier is a product list.
      // Cover every naming variant AliExpress has shipped (DS, Affiliate,
      // Solution, plus snake_case + camelCase + selection_search shapes).
      if (
        f.product_id !== undefined ||
        f.productId !== undefined ||
        f.item_id !== undefined ||
        f.itemId !== undefined ||
        (typeof f.title === "string" &&
          (f.product_main_image_url !== undefined ||
            f.image_url !== undefined ||
            f.product_image_url !== undefined ||
            f.itemMainPic !== undefined)) ||
        (typeof f.subject === "string" &&
          f.product_main_image_url !== undefined)
      ) {
        return obj;
      }
    }
    return null;
  }
  if (typeof obj === "object") {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      const found = findProductArrayDeep(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function parseSingleProduct(raw: unknown): AliExpressProduct | null {
  const root = raw as Record<string, unknown>;
  const wrapper = findFirst(root, (k) => k.endsWith("_response"));
  const resp = findFirst(wrapper ?? root, (k) => k === "resp_result") ?? wrapper;
  const result = findFirst(resp ?? root, (k) => k === "result") ?? resp;
  const productNode =
    findFirst(result as Record<string, unknown>, (k) =>
      k.startsWith("ae_item_") || k.includes("product"),
    ) ?? result;

  if (!productNode || typeof productNode !== "object") return null;
  return normalizeProduct(productNode as RawProduct);
}

function findFirst(
  obj: unknown,
  matcher: (key: string) => boolean,
): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (matcher(key)) {
      const v = o[key];
      if (v && typeof v === "object") return v as Record<string, unknown>;
    }
  }
  return null;
}

function extractArray(v: unknown): unknown[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Common AliExpress shape: { product: [...] } or { item: [...] }
    for (const key of ["product", "item", "products", "items"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return null;
}
