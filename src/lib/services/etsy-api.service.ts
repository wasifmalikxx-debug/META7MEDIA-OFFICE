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
 * Find taxonomy nodes that fuzzy-match a query. Scores each candidate
 * along three dimensions and picks the highest-scoring matches:
 *
 *   1000 — node name is a substring of the query (e.g. node "Pants",
 *          query "men's linen pants")
 *    900 — query is a substring of the node name (e.g. node
 *          "Pants & Capris", query "pants")
 *   +100 — per shared whole word
 *    +50 — per partial word prefix match (handles singular/plural drift,
 *          e.g. "pant" ↔ "pants")
 *
 * Ties break first by depth (deeper / more specific node wins) then by
 * shorter name. Returns up to `limit` results sorted by total score.
 */
export async function searchTaxonomyNodes(
  query: string,
  limit = 12,
): Promise<EtsyTaxonomyNode[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await getSellerTaxonomy();

  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .split(/[\s,\-_/|.()&]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3);

  const qWords = new Set(tokenize(q));

  const scored = all
    .map((n) => {
      const name = n.name.toLowerCase();
      let score = 0;

      // Direct substring match (either direction).
      if (name === q) {
        score = 2000;
      } else if (name.includes(q)) {
        score = 1000;
      } else if (name.length >= 3 && q.includes(name)) {
        score = 900;
      } else {
        // Word-level overlap.
        const nWords = tokenize(name);
        for (const w of nWords) {
          if (qWords.has(w)) {
            score += 100;
          } else if (w.length >= 4) {
            // Prefix/plural drift — "pant" matches "pants" and vice versa.
            for (const qw of qWords) {
              if (qw.length >= 4 && (qw.startsWith(w) || w.startsWith(qw))) {
                score += 50;
                break;
              }
            }
          }
        }
      }

      return { node: n, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.node.level !== b.node.level) return b.node.level - a.node.level;
      return a.node.name.length - b.node.name.length;
    });

  return scored.slice(0, limit).map((s) => s.node);
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

// ─── Tag intelligence (demand proxy) ────────────────────────────────

/**
 * Etsy doesn't expose real search volume publicly. As a proxy we look
 * at how many active listings exist for the tag and how favorited the
 * top-ranking ones are. Together they give a strong signal for:
 *   • how much demand there is (high listing count + favs = real buyers)
 *   • how saturated the market is (very high count = hard to rank)
 *
 * Costs one Etsy API call per tag.
 */

export type TagTier = "niche" | "moderate" | "hot" | "saturated";

export interface TagDemand {
  tag: string;
  totalListings: number;
  topFavorites: number[]; // up to 5
  avgTopFavorites: number;
  demandScore: number; // 0..100
  tier: TagTier;
  error?: string;
}

function classifyTier(totalListings: number): TagTier {
  if (totalListings >= 50_000) return "saturated";
  if (totalListings >= 10_000) return "hot";
  if (totalListings >= 1_000) return "moderate";
  return "niche";
}

function calcDemandScore(totalListings: number, avgFavs: number): number {
  // Log-scaled listing count contributes up to ~75, average favs up to ~25.
  const listingComponent = Math.min(75, Math.log10(totalListings + 1) * 15);
  const favComponent = Math.min(25, avgFavs / 8);
  return Math.round(Math.min(100, listingComponent + favComponent));
}

/**
 * Fetch demand stats for a single tag.
 *
 * Strategy: one call to /listings/active with limit=5, sort_on=score.
 * The response's `count` field gives total active listings (the
 * "demand" proxy) and the 5 results give us top-favorite signal.
 */
export async function getTagDemandStats(tag: string): Promise<TagDemand> {
  const apiKey = process.env.ETSY_API_KEYSTRING;
  const sharedSecret = process.env.ETSY_SHARED_SECRET;
  if (!apiKey || !sharedSecret) {
    return {
      tag,
      totalListings: 0,
      topFavorites: [],
      avgTopFavorites: 0,
      demandScore: 0,
      tier: "niche",
      error: "Etsy credentials missing",
    };
  }

  try {
    const data = await etsyFetch<ListingsResponse>("/listings/active", {
      keywords: tag,
      limit: 5,
      sort_on: "score",
      sort_order: "desc",
    });
    const totalListings = data.count ?? 0;
    const topFavorites = (data.results ?? [])
      .map((l) => l.num_favorers ?? 0)
      .sort((a, b) => b - a);
    const avgTopFavorites =
      topFavorites.length > 0
        ? Math.round(
            topFavorites.reduce((s, n) => s + n, 0) / topFavorites.length,
          )
        : 0;
    return {
      tag,
      totalListings,
      topFavorites,
      avgTopFavorites,
      demandScore: calcDemandScore(totalListings, avgTopFavorites),
      tier: classifyTier(totalListings),
    };
  } catch (err) {
    return {
      tag,
      totalListings: 0,
      topFavorites: [],
      avgTopFavorites: 0,
      demandScore: 0,
      tier: "niche",
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

/**
 * Fetch demand stats for many tags. Calls go through the token bucket
 * so we stay under 5 QPS even with 13 concurrent fetches.
 */
export async function getTagDemandStatsBatch(
  tags: string[],
): Promise<TagDemand[]> {
  // Promise.all is fine — takeToken() inside etsyFetch serializes for us.
  return Promise.all(tags.map((t) => getTagDemandStats(t)));
}

/**
 * Infer the target taxonomy node from a set of ranking listings.
 *
 * Cascade (stops at first hit):
 *   1. Tally `taxonomy_id` across the top 15 ranking listings,
 *      weighted by rank. Best signal when Etsy returns it.
 *   2. Fuzzy search the full `productTypeHint` in node names.
 *   3. Same query with possessives/quotes stripped ("men's" → "men").
 *   4. Each word of the hint, longest first (≥3 chars).
 *   5. Each meaningful word from the original title, longest first
 *      (≥4 chars, skipping pure numbers and obvious filler words).
 *
 * Only returns null when all five strategies miss — should be very
 * rare in practice.
 */

const FILLER_WORDS = new Set([
  "with",
  "from",
  "this",
  "that",
  "your",
  "ours",
  "have",
  "more",
  "also",
  "very",
  "just",
  "only",
  "into",
  "over",
  "best",
  "wholesale",
  "cheap",
  "free",
  "new",
  "hot",
  "sale",
  "shipping",
  "premium",
  "luxury",
  "high",
  "quality",
  "fashion",
  "style",
  "design",
]);

function buildFallbackQueries(
  productTypeHint: string,
  rawTitle?: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    const cleaned = q
      .toLowerCase()
      .replace(/['’]s\b/g, "") // possessives ("men's" → "men")
      .replace(/['’]/g, " ")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 3 || seen.has(cleaned)) return;
    seen.add(cleaned);
    out.push(cleaned);
  };

  // Full + cleaned versions of the hint
  if (productTypeHint) {
    add(productTypeHint);
  }

  const wordsOf = (s: string) =>
    s
      .toLowerCase()
      .replace(/['’]/g, " ")
      .split(/[\s,\-_/|.()]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !FILLER_WORDS.has(w));

  // Hint words, longest first
  const hintWords = wordsOf(productTypeHint);
  hintWords.sort((a, b) => b.length - a.length);
  hintWords.forEach(add);

  // Title words, longest first, top 10
  if (rawTitle) {
    const titleWords = wordsOf(rawTitle).filter((w) => w.length >= 4);
    titleWords.sort((a, b) => b.length - a.length);
    titleWords.slice(0, 10).forEach(add);
  }

  return out;
}

export async function inferCategoryFromListings(
  listings: EtsyListing[],
  productTypeHint: string,
  rawTitle?: string,
): Promise<{ id: number; name: string; path: string } | null> {
  const all = await getSellerTaxonomy();

  // ─── Strategy 1: tally taxonomy_id, weighted by rank ───────────────
  const tally = new Map<number, number>();
  listings.slice(0, 15).forEach((l, i) => {
    if (!l.taxonomy_id) return;
    const weight = 15 - i; // rank 1 = 15× weight, rank 15 = 1×
    tally.set(l.taxonomy_id, (tally.get(l.taxonomy_id) ?? 0) + weight);
  });
  if (tally.size > 0) {
    const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const node = all.find((n) => n.id === winner[0]);
    if (node) {
      return {
        id: node.id,
        name: node.name,
        path: await getTaxonomyPath(node.id),
      };
    }
  }

  // ─── Strategy 2-5: cascade through fallback queries ────────────────
  const queries = buildFallbackQueries(productTypeHint, rawTitle);
  for (const q of queries) {
    const matches = await searchTaxonomyNodes(q, 1);
    if (matches.length > 0) {
      const node = matches[0];
      return {
        id: node.id,
        name: node.name,
        path: await getTaxonomyPath(node.id),
      };
    }
  }

  return null;
}
