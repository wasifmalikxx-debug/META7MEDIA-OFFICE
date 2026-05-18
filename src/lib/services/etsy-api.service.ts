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

// ─── Token bucket — keeps us under Etsy's 5 QPS cap ──────────────────
//
// Bucket cap = 1, refill = 1 token per 300 ms ⇒ sustained 3.3 QPS with
// NO initial burst. The earlier "cap = 4" version let a single
// generation fire 4 requests in <1 ms, which combined with the natural
// refill rate spiked to ~8 requests in the first second and tripped
// Etsy's per-second limit.
//
// Sustained 3.3 QPS still finishes a full generation (~40 Etsy calls
// at peak: search + taxonomy + properties + 13 tag intel + 25 buyer-
// keyword evaluations) in ~12 seconds, comfortably under the 90 s route
// timeout.

let tokens = 1;
let lastRefill = Date.now();
const BUCKET_CAP = 1;
const REFILL_MS = 300;

async function takeToken(): Promise<void> {
  while (tokens <= 0) {
    const now = Date.now();
    const elapsed = now - lastRefill;
    if (elapsed >= REFILL_MS) {
      tokens = Math.min(BUCKET_CAP, tokens + Math.floor(elapsed / REFILL_MS));
      lastRefill = now;
    }
    if (tokens <= 0) {
      await new Promise((r) => setTimeout(r, 80));
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

  const url = new URL(`${ETSY_BASE}${path}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  // Retry-with-backoff on 429 (and 5xx). Cold-start instances or
  // concurrent Vercel functions can briefly exceed the global 5 QPS
  // even with our token bucket — the retry catches that. Backoff:
  // 800 ms → 1.6 s → 3.2 s.
  const MAX_ATTEMPTS = 4;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await takeToken();

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      // Always go fresh — Etsy's data changes constantly and we want
      // true ranking signals each generation. Caching at this layer
      // would hide changes from the AI's context window.
      cache: "no-store",
    });

    if (res.status === 429 || res.status >= 500) {
      // Etsy is asking us to slow down (or had an internal glitch).
      // Wait, then retry.
      const backoffMs = 800 * Math.pow(2, attempt);
      const body = await res.text().catch(() => "");
      lastError = new Error(
        `Etsy API ${res.status} on ${path} (attempt ${attempt + 1}/${MAX_ATTEMPTS}): ${body.slice(0, 120) || res.statusText}`,
      );
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw lastError;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Etsy API ${res.status} on ${path}: ${body.slice(0, 200) || res.statusText}`,
      );
    }

    return (await res.json()) as T;
  }

  throw lastError ?? new Error(`Etsy API exhausted retries on ${path}`);
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
  // Shop ownership — used by Product Hunter to measure top-10
  // diversity (how many unique shops dominate a search). Not every
  // search response includes it; treat as optional.
  shop_id?: number;
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
 * Same search, but ALSO returns the total `count` from Etsy's response —
 * the universe of active listings matching the keyword. Used by Product
 * Hunter where saturation (count) is the headline signal, not just the
 * top 20 sample.
 */
export async function searchActiveListingsWithCount(
  keywords: string,
  limit = 10,
  sortOn: "score" | "created" | "price" = "score",
): Promise<{ totalListings: number; results: EtsyListing[] }> {
  const safeLimit = Math.min(100, Math.max(1, limit));
  const data = await etsyFetch<ListingsResponse>("/listings/active", {
    keywords: keywords.trim(),
    limit: safeLimit,
    sort_on: sortOn,
    sort_order: "desc",
  });
  return {
    totalListings: data.count ?? 0,
    results: data.results ?? [],
  };
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

// ─── Keyword frequency analysis ─────────────────────────────────────

/**
 * Extract the highest-signal keywords from a set of ranking listings.
 * Goal: surface the phrases and tags that REPEATEDLY appear in winning
 * listings so we can deliberately front-load them in our title + tags.
 *
 * Etsy's search algorithm weights:
 *   - title (especially first 40 chars) >> tags > description
 *
 * Phrases (especially 2-word bigrams) that appear in 50%+ of the top
 * 20 listings are basically free ranking signal — we'd be dumb not to
 * use them.
 *
 * Used by: /api/seo-autopilot/generate
 */

const STOP_WORDS = new Set([
  // common English filler
  "the", "and", "for", "with", "from", "this", "that", "these", "those",
  "your", "our", "their", "his", "her", "its", "him", "she", "have", "has",
  "had", "are", "is", "was", "were", "be", "been", "being",
  "as", "at", "in", "on", "of", "to", "by", "but", "or", "if", "not",
  "all", "any", "some", "each", "every", "no", "yes",
  // marketing fluff
  "new", "hot", "best", "premium", "luxury", "free", "fast", "sale", "deal",
  "exclusive", "limited", "amazing", "perfect", "great", "good", "gorgeous",
  "stunning", "beautiful", "pretty", "lovely", "shiny", "trendy",
  "high", "low", "top", "wholesale", "cheap",
  // size/color descriptors (handled as variations elsewhere)
  "size", "color", "colour", "design", "style", "type", "kind",
]);

function tokenizeTitle(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/'s\b/g, "") // possessives
    .replace(/'/g, "")
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 3 &&
        !STOP_WORDS.has(t) &&
        !/^\d+$/.test(t),
    );
}

export interface KeywordFrequency {
  phrase: string;
  count: number;
  /** Percentage of analyzed listings the phrase appears in (0-100). */
  percentage: number;
}

export interface AnchorKeywords {
  topPhrases: KeywordFrequency[]; // mix of 1-word and 2-word phrases
  topTags: KeywordFrequency[]; // seller-curated tags
  totalListings: number;
}

/**
 * Surface high-frequency phrases + tags from ranking listings.
 *
 * Algorithm:
 *   1. Tokenize each title, drop stop words and short tokens.
 *   2. Count single-word occurrences (per listing — multi-occurrence
 *      in one title counts once).
 *   3. Count 2-word bigrams the same way.
 *   4. Sort by occurrence count, tie-break favouring bigrams (more
 *      specific). Threshold: must appear in at least 2 listings.
 *   5. Do the same for explicit tags (already curated by sellers, so
 *      a strong intent signal).
 */
export function analyzeKeywordFrequencies(
  listings: EtsyListing[],
  topN = 10,
): AnchorKeywords {
  const totalListings = listings.length;
  if (totalListings === 0) {
    return { topPhrases: [], topTags: [], totalListings: 0 };
  }

  // Phrase frequencies in titles.
  const phraseFreq = new Map<string, number>();

  for (const l of listings) {
    if (!l.title) continue;
    const words = tokenizeTitle(l.title);

    // Unique single words (per listing).
    const uniqueWords = new Set(words);
    for (const w of uniqueWords) {
      phraseFreq.set(w, (phraseFreq.get(w) ?? 0) + 1);
    }

    // Unique bigrams (per listing).
    const uniqueBigrams = new Set<string>();
    for (let i = 0; i < words.length - 1; i++) {
      uniqueBigrams.add(`${words[i]} ${words[i + 1]}`);
    }
    for (const bg of uniqueBigrams) {
      phraseFreq.set(bg, (phraseFreq.get(bg) ?? 0) + 1);
    }
  }

  const topPhrases: KeywordFrequency[] = [...phraseFreq.entries()]
    .filter(([, c]) => c >= 2) // must appear in 2+ listings
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      // tie: prefer bigrams (more specific) and shorter words
      const aBg = a[0].includes(" ");
      const bBg = b[0].includes(" ");
      if (aBg !== bBg) return aBg ? -1 : 1;
      return a[0].length - b[0].length;
    })
    .slice(0, topN)
    .map(([phrase, count]) => ({
      phrase,
      count,
      percentage: Math.round((count / totalListings) * 100),
    }));

  // Tag frequencies — sellers manually pick these so it's high signal.
  const tagFreq = new Map<string, number>();
  for (const l of listings) {
    if (!l.tags) continue;
    const uniq = new Set<string>();
    for (const t of l.tags) {
      const cleaned = (t ?? "").toLowerCase().trim();
      if (cleaned.length >= 2) uniq.add(cleaned);
    }
    for (const t of uniq) {
      tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
    }
  }

  const topTags: KeywordFrequency[] = [...tagFreq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag, count]) => ({
      phrase: tag,
      count,
      percentage: Math.round((count / totalListings) * 100),
    }));

  return { topPhrases, topTags, totalListings };
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

// Note: `evaluateKeywordCandidates` (scored buyer-search variants
// against live Etsy demand) was removed May 14 2026 — it cost 25 Etsy
// API calls per generation (~64% of the daily 5K quota) for marginal
// SEO gain. The Haiku brainstorm output still feeds into Sonnet's
// prompt as alternative-angle inspiration, just unscored.

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
