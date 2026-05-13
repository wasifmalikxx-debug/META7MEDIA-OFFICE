/**
 * Etsy Open API v3 client.
 *
 * Personal Access tier — public read-only data only:
 *   • Active listing search (keyword → top ranking listings)
 *   • Seller taxonomy (the full Etsy category tree)
 *   • Taxonomy node properties (required + optional attributes per category)
 *
 * Auth: `x-api-key` header in the format `keystring:shared_secret`.
 *   Etsy changed this — it used to be keystring-only, now they require
 *   both pieces colon-separated. If only the keystring is sent, Etsy
 *   returns 403 with: "Shared secret is required in x-api-key header."
 *   No OAuth bearer needed for the public read endpoints we use.
 *
 * Rate limit at Personal tier: 5 QPS · 5,000 requests/day. At full SEO
 * Autopilot usage (25 employees × 7 listings/day × ~3 queries) we burn ~10%
 * of daily quota, so no batching / queue logic needed here — but we DO
 * honour a global mini-throttle in-process so a single fast user can't
 * spike past 5 QPS.
 *
 * Used by: /api/seo-autopilot/* routes. Not safe to import from client
 * components — the API key must stay on the server.
 */

const ETSY_BASE = "https://openapi.etsy.com/v3/application";

// ─── Tiny token-bucket so concurrent generations don't exceed 5 QPS ───
// We size the bucket at 4 (one below the cap) for headroom. Each request
// takes a token and refills on a 250 ms cadence (= 4 tokens/sec).

let tokens = 4;
let lastRefill = Date.now();

async function takeToken(): Promise<void> {
  while (tokens <= 0) {
    // Refill on a fixed cadence.
    const now = Date.now();
    const elapsed = now - lastRefill;
    if (elapsed >= 250) {
      tokens = Math.min(4, tokens + Math.floor(elapsed / 250));
      lastRefill = now;
    }
    if (tokens <= 0) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  tokens--;
}

// ─── Generic fetch ────────────────────────────────────────────────────

async function etsyFetch<T>(
  path: string,
  searchParams?: Record<string, string | number | undefined>,
): Promise<T> {
  const keystring = process.env.ETSY_API_KEYSTRING;
  const sharedSecret = process.env.ETSY_SHARED_SECRET;
  if (!keystring) {
    throw new Error(
      "ETSY_API_KEYSTRING is not set. Add it to your environment variables.",
    );
  }
  if (!sharedSecret) {
    throw new Error(
      "ETSY_SHARED_SECRET is not set. Etsy requires it in the x-api-key header as 'keystring:shared_secret'.",
    );
  }
  // Etsy's current v3 auth format. See header doc at top of file.
  const apiKey = `${keystring}:${sharedSecret}`;

  await takeToken();

  const url = new URL(`${ETSY_BASE}${path}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "x-api-key": apiKey, Accept: "application/json" },
    // Always go fresh — Etsy's data changes constantly and we want true
    // ranking signals each generation. Caching at this layer would hide
    // changes from the AI's context window.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Etsy API ${res.status} on ${path}: ${body.slice(0, 200) || res.statusText}`,
    );
  }

  return (await res.json()) as T;
}

// ─── Types — only the fields we use ───────────────────────────────────

export interface EtsyListing {
  listing_id: number;
  title: string;
  description?: string;
  tags?: string[];
  price?: { amount: number; divisor: number; currency_code: string };
  url?: string;
  views?: number;
  num_favorers?: number;
  taxonomy_id?: number;
}

export interface EtsyTaxonomyNode {
  id: number;
  level: number;
  name: string;
  parent_id: number | null;
  children_ids?: number[];
  full_path_taxonomy_ids?: number[];
}

export interface EtsyProperty {
  property_id: number;
  name: string;
  display_name: string;
  scales?: { scale_id: number; name: string }[];
  is_required?: boolean;
  supports_attributes?: boolean;
  supports_variations?: boolean;
  possible_values?: { value_id: number; name: string }[];
  selected_values?: { value_id: number; name: string }[];
}

interface ListingsResponse {
  count: number;
  results: EtsyListing[];
}

interface TaxonomyResponse {
  count: number;
  results: EtsyTaxonomyNode[];
}

interface PropertiesResponse {
  count: number;
  results: EtsyProperty[];
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Search active Etsy listings by keyword, sorted by Etsy's own relevance
 * score. The first ~20 results are the "what's currently winning for this
 * search" signal — exactly what we want to feed Claude as competitor copy.
 *
 * @param keywords    space-separated search query
 * @param limit       1-100 (Etsy cap)
 * @param sortOn      "score" (default) | "created" | "price"
 */
export async function searchActiveListings(
  keywords: string,
  limit = 20,
  sortOn: "score" | "created" | "price" = "score",
): Promise<EtsyListing[]> {
  const safeLimit = Math.min(100, Math.max(1, limit));
  const data = await etsyFetch<ListingsResponse>("/listings/active", {
    keywords: keywords.trim(),
    limit: safeLimit,
    sort_on: sortOn,
    sort_order: "desc",
  });
  return data.results ?? [];
}

/**
 * Full Etsy seller taxonomy. Returns ~3,000 nodes (categories +
 * subcategories). Cached aggressively in-process since it changes maybe
 * once a year.
 */
let _taxonomyCache: { fetchedAt: number; nodes: EtsyTaxonomyNode[] } | null = null;
const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function getSellerTaxonomy(): Promise<EtsyTaxonomyNode[]> {
  if (_taxonomyCache && Date.now() - _taxonomyCache.fetchedAt < TAXONOMY_TTL_MS) {
    return _taxonomyCache.nodes;
  }
  const data = await etsyFetch<TaxonomyResponse>("/seller-taxonomy/nodes");
  _taxonomyCache = { fetchedAt: Date.now(), nodes: data.results ?? [] };
  return _taxonomyCache.nodes;
}

/**
 * All required + optional listing attributes for a taxonomy node.
 * Driven by Etsy's category rules (e.g. jewellery has "material",
 * "metal purity"; clothing has "size", "garment type"; home decor has
 * "room", "style").
 */
export async function getNodeProperties(
  taxonomyId: number,
): Promise<EtsyProperty[]> {
  const data = await etsyFetch<PropertiesResponse>(
    `/seller-taxonomy/nodes/${taxonomyId}/properties`,
  );
  return data.results ?? [];
}

// ─── Convenience helpers ──────────────────────────────────────────────

/**
 * Find taxonomy nodes whose name matches a fuzzy query. Used by the
 * category autocomplete. Returns leaf-level matches first (level >= 2)
 * since those carry the most specific attribute schemas.
 */
export async function searchTaxonomyNodes(
  query: string,
  limit = 12,
): Promise<EtsyTaxonomyNode[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await getSellerTaxonomy();
  const matches = all
    .filter((n) => n.name.toLowerCase().includes(q))
    // Prefer deeper nodes first — "Earrings" beats "Jewelry".
    .sort((a, b) => {
      if (a.level !== b.level) return b.level - a.level;
      return a.name.length - b.name.length;
    });
  return matches.slice(0, limit);
}

/**
 * Build a human-readable path for a taxonomy node by walking its parents.
 * E.g. node 2078 ("Stud Earrings") → "Jewelry > Earrings > Stud Earrings".
 */
export async function getTaxonomyPath(taxonomyId: number): Promise<string> {
  const all = await getSellerTaxonomy();
  const byId = new Map(all.map((n) => [n.id, n]));
  const node = byId.get(taxonomyId);
  if (!node) return "";
  const parts: string[] = [];
  let cur: EtsyTaxonomyNode | undefined = node;
  while (cur) {
    parts.unshift(cur.name);
    if (cur.parent_id == null) break;
    cur = byId.get(cur.parent_id);
  }
  return parts.join(" > ");
}

/**
 * Distil a search result into the lean shape we feed to Claude — drop
 * the noise (urls, ids, images) and keep title + tags + favor count.
 */
export interface CompetitorBrief {
  rank: number;
  title: string;
  tags: string[];
  favorites: number;
  taxonomyId: number | null;
}

export function toCompetitorBriefs(listings: EtsyListing[]): CompetitorBrief[] {
  return listings.map((l, i) => ({
    rank: i + 1,
    title: l.title,
    tags: l.tags ?? [],
    favorites: l.num_favorers ?? 0,
    taxonomyId: l.taxonomy_id ?? null,
  }));
}

/**
 * Infer the target taxonomy node from a set of ranking listings. The
 * idea: if the top 5-10 listings ranking for our keyword all sit in
 * the same category, that's almost certainly where ours should live
 * too. Returns the most-frequent `taxonomy_id` among the supplied
 * listings.
 *
 * Falls back to a fuzzy taxonomy name search using `productTypeHint`
 * if the listings have no agreement (or no taxonomy_id at all).
 */
export async function inferCategoryFromListings(
  listings: EtsyListing[],
  productTypeHint: string,
): Promise<{ id: number; name: string; path: string } | null> {
  // Tally taxonomy ids from the top 10 listings, weighted by rank.
  const tally = new Map<number, number>();
  listings.slice(0, 10).forEach((l, i) => {
    if (!l.taxonomy_id) return;
    // Rank 1 is worth 10, rank 10 is worth 1 — top-ranking signals matter more.
    const weight = 10 - i;
    tally.set(l.taxonomy_id, (tally.get(l.taxonomy_id) ?? 0) + weight);
  });

  if (tally.size > 0) {
    // Pick the highest-weighted taxonomy id.
    const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const [taxonomyId] = winner;
    const all = await getSellerTaxonomy();
    const node = all.find((n) => n.id === taxonomyId);
    if (node) {
      return {
        id: node.id,
        name: node.name,
        path: await getTaxonomyPath(node.id),
      };
    }
  }

  // Fallback — fuzzy taxonomy search using the product-type hint.
  if (productTypeHint.trim().length >= 2) {
    const matches = await searchTaxonomyNodes(productTypeHint, 1);
    const node = matches[0];
    if (node) {
      return {
        id: node.id,
        name: node.name,
        path: await getTaxonomyPath(node.id),
      };
    }
  }

  return null;
}
