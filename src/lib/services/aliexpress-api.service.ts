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

// ─── Token bucket (5 QPS app-wide, same shape as Etsy service) ──────
// AliExpress Personal Access tier caps at 5 QPS / 5K QPD. We use a
// conservative cap=1 refill=300ms (3.3 QPS sustained) to leave headroom.

let bucketTokens = 1;
let lastRefillAt = Date.now();
const BUCKET_CAP = 1;
const REFILL_MS = 300;

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

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await acquireSlot();
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`AliExpress ${res.status}`);
          await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(
          `AliExpress ${method} failed: ${res.status} ${await res.text()}`,
        );
      }
      const json = await res.json();
      // AliExpress wraps errors INSIDE 200 responses sometimes:
      //   { error_response: { code, msg, sub_msg } }
      if (json?.error_response) {
        const err = json.error_response;
        // Log full error to Vercel logs so the user can see exactly
        // what AliExpress complained about (code + msg + which method)
        console.error(
          `[aliexpress] ${method} returned error_response:`,
          JSON.stringify(err).slice(0, 400),
        );
        throw new Error(
          `AliExpress error ${err.code}: ${err.sub_msg ?? err.msg ?? "unknown"}`,
        );
      }
      // Log a one-line summary of the success response so we can see
      // exactly what shape AliExpress returns for each method.
      console.log(
        `[aliexpress] ${method} ok — top-level keys: ${Object.keys(json).join(", ")}`,
      );
      return json as T;
    } catch (err) {
      lastErr = err;
      if (attempt === 3) break;
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
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
 * `aliexpress.ds.text.search` is the documented DS search method (some
 * older docs say `aliexpress.ds.product.list` — both are recognized).
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
  const params: Record<string, string | number> = {
    keyWord: keyword,
    local: "en_US",
    countryCode: "US",
    currency: options.targetCurrency ?? "USD",
    pageSize: options.pageSize ?? 20,
    pageNo: options.pageNo ?? 1,
  };
  if (options.sortBy) params.sortBy = options.sortBy;
  if (options.minPrice !== undefined) params.minPrice = options.minPrice;
  if (options.maxPrice !== undefined) params.maxPrice = options.maxPrice;

  const raw = await aliExpressCall<Record<string, unknown>>(
    "aliexpress.ds.text.search",
    params,
    options.accessToken,
  );

  return parseProductSearch(raw);
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
  product_id?: number | string;
  productId?: number | string;
  title?: string;
  product_title?: string;
  subject?: string;
  product_main_image_url?: string;
  product_image_url?: string;
  image_url?: string;
  product_detail_url?: string;
  promotion_link?: string;
  target_sale_price?: string | number;
  target_app_sale_price?: string | number;
  app_sale_price?: string | number;
  sale_price?: string | number;
  original_price?: string | number;
  target_original_price?: string | number;
  target_sale_price_currency?: string;
  evaluate_rate?: string | number;
  product_rating?: string | number;
  lastest_volume?: number;
  trade_count?: number;
  shop_id?: number;
  shop_name?: string;
  ship_from_country?: string;
}

function normalizeProduct(raw: RawProduct): AliExpressProduct {
  const productId = Number(raw.product_id ?? raw.productId ?? 0);
  const priceMin = Number(
    raw.target_app_sale_price ??
      raw.target_sale_price ??
      raw.app_sale_price ??
      raw.sale_price ??
      0,
  );
  const priceMax = Number(
    raw.target_original_price ?? raw.original_price ?? priceMin,
  );
  return {
    productId,
    title: raw.title ?? raw.product_title ?? raw.subject ?? "",
    imageUrl:
      raw.product_main_image_url ??
      raw.product_image_url ??
      raw.image_url,
    productUrl: raw.product_detail_url ?? raw.promotion_link,
    priceMin,
    priceMax,
    currency: raw.target_sale_price_currency ?? "USD",
    rating: raw.evaluate_rate
      ? Number(String(raw.evaluate_rate).replace("%", ""))
      : raw.product_rating
        ? Number(raw.product_rating)
        : undefined,
    orderCount: raw.lastest_volume ?? raw.trade_count,
    shopId: raw.shop_id,
    shopName: raw.shop_name,
    shipsFrom: raw.ship_from_country,
  };
}

function parseProductSearch(raw: unknown): ProductSearchResponse {
  // The wrapper key changes per method — drill until we find a
  // resp_result.result or similar.
  const root = raw as Record<string, unknown>;
  const wrapper = findFirst(root, (k) => k.endsWith("_response"));
  const resp = findFirst(wrapper ?? root, (k) => k === "resp_result") ?? wrapper;
  const result = findFirst(resp ?? root, (k) => k === "result") ?? resp;

  if (!result || typeof result !== "object") {
    return { totalResults: 0, products: [] };
  }

  const r = result as Record<string, unknown>;
  const total = Number(
    r.total_record_count ?? r.totalRecord ?? r.total_result_count ?? 0,
  );

  // Products typically live under r.products.product[] or r.product_list
  const list =
    extractArray(r.products) ??
    extractArray(r.product_list) ??
    extractArray(r.product) ??
    [];

  return {
    totalResults: total,
    products: list.map((p) => normalizeProduct(p as RawProduct)),
  };
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
