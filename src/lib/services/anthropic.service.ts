/**
 * Anthropic Claude client for SEO Autopilot.
 *
 * Pipeline:
 *
 *   0. HAIKU extracts search context from the raw AliExpress title
 *      (keyword + product type). Drives the Etsy search.
 *
 *   1. HAIKU VISION gatekeeps — looks at the regenerated product images
 *      + title and decides whether the product is allowed on Etsy. If
 *      BLOCKED (trademark, prohibited item, counterfeit, adult-in-wrong-
 *      category), the pipeline stops here and no listing is generated.
 *      Switched from Sonnet → Haiku May 14 to cut per-gen cost by ~$0.01:
 *      Haiku 4.5 reads images at ~1/3 the input cost and is plenty for
 *      a binary verdict on visible IP / trademarks.
 *
 *   2. SONNET (vision) writes the full listing — title, 13 tags,
 *      description, alt text per image.
 *
 * Output is forced into strict JSON via the prefilled-`{` trick + a
 * schema-shaped system prompt. We then JSON.parse and normalize.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  CompetitorBrief,
  AnchorKeywords,
} from "./etsy-api.service";

// Lazy singleton — the SDK init grabs ANTHROPIC_API_KEY from env, but we
// want a clear error message if it's not set.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your environment variables.",
    );
  }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

// Pinned model snapshots — bump deliberately when we want behaviour changes,
// don't let the alias drift mid-month.
const MODEL_GENERATOR = "claude-sonnet-4-5-20250929";
// Haiku 4.5 — vision-capable, 1/3 the input cost of Sonnet. Compliance
// is a strict yes / no / maybe verdict; the heavier reasoning Sonnet
// offers isn't paying its way here. Haiku still catches obvious IP
// (Disney/Pokemon/Nike/etc) reliably in real-world product photos.
const MODEL_COMPLIANCE = "claude-haiku-4-5-20251001";
const MODEL_VALIDATOR = "claude-haiku-4-5-20251001"; // Haiku — cheap text checks

// ─── Cost tracking ──────────────────────────────────────────────────
//
// Every Anthropic call returns `msg.usage` with token counts. We use
// these + the model's pricing to compute the actual USD cost per call,
// then sum across all calls in a generation request. The route passes
// a CostAccumulator into each helper; helpers push their per-call
// usage in after every API response.
//
// Pricing — May 2026, per Anthropic's published rates. Values are
// dollars per MILLION tokens.
const PRICING_PER_M = {
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
} as const;

type AnthropicModelKind = "sonnet" | "haiku";

function modelKindFromId(modelId: string): AnthropicModelKind {
  return modelId.includes("sonnet") ? "sonnet" : "haiku";
}

export interface CostAccumulator {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
}

export function createCostAccumulator(): CostAccumulator {
  return {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
  };
}

/**
 * Compute the actual USD cost of a single Anthropic message response
 * and push the token + cost numbers into the accumulator. The token
 * counts on `msg.usage` are authoritative — Anthropic bills off these
 * exactly. cache_read_input_tokens and cache_creation_input_tokens may
 * be undefined on responses with no caching activity (treat as 0).
 */
function trackUsage(
  accum: CostAccumulator | undefined,
  msg: Anthropic.Message,
  model: AnthropicModelKind,
): void {
  if (!accum) return;
  const u = msg.usage;
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const p = PRICING_PER_M[model];
  const costUsd =
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite) /
    1_000_000;

  accum.totalCostUsd += costUsd;
  accum.totalInputTokens += inputTokens;
  accum.totalOutputTokens += outputTokens;
  accum.totalCacheReadTokens += cacheRead;
  accum.totalCacheWriteTokens += cacheWrite;
}

// ─── Etsy listing rules — the source of truth for output validation ──

export const ETSY_LIMITS = {
  TITLE_MAX: 140,
  TAG_MAX_CHARS: 20,
  TAG_COUNT: 13,
  DESCRIPTION_MAX: 5000,
  ALT_TEXT_MAX: 250,
} as const;

// ─── Image payload (shared between compliance + generation) ──────────

export interface ImagePayload {
  /** Base64 string WITHOUT the "data:image/jpeg;base64," prefix. */
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

type ContentBlock = Anthropic.Messages.ContentBlockParam;

function toImageBlocks(images: ImagePayload[]): ContentBlock[] {
  return images.map(
    (img): ContentBlock => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.base64,
      },
    }),
  );
}

// ─── Stage 0 — Context extraction (Haiku, text only) ────────────────

export interface ExtractedContext {
  searchKeyword: string;
  productType: string;
  audienceHint: string;
  styleHint: string;
}

const EXTRACTOR_SYSTEM = `You read noisy AliExpress / supplier product titles and extract clean Etsy SEO context.

AliExpress titles are keyword-stuffed: brand codes ("ROSES"), marketing fluff ("Gorgeous", "Premium Quality"), repeated words, and SKU info all mixed together. Your job is to distill them.

OUTPUT — strict JSON, no prose:
{
  "searchKeyword": "2-5 words a real buyer would type into Etsy search",
  "productType": "1-3 word product noun (matches Etsy taxonomy language — e.g. 'prom dress', 'leather wallet', 'stud earrings')",
  "audienceHint": "short phrase guessing target buyer (e.g. 'wedding guest', 'father's day gift'). Empty string if not clear.",
  "styleHint": "1-3 style/aesthetic words (e.g. 'minimalist', 'boho rustic'). Empty string if not clear."
}

Rules:
- searchKeyword should be what a buyer types — NOT the AliExpress title verbatim. Drop brand codes, modifiers like "shiny", "new", "hot sale", "wholesale".
- Prefer descriptive over generic — "off shoulder prom dress" beats "dress".
- productType MUST match how Etsy categorises things (singular OK if Etsy uses singular, plural OK if plural).
- Never invent details not present in the title.`;

export async function extractSearchContext(
  rawTitle: string,
  accum?: CostAccumulator,
): Promise<ExtractedContext> {
  const userPrompt = `AliExpress / source title:\n${rawTitle}`;

  const msg = await client().messages.create({
    model: MODEL_VALIDATOR,
    max_tokens: 300,
    temperature: 0,
    system: EXTRACTOR_SYSTEM,
    messages: [
      { role: "user", content: userPrompt },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_VALIDATOR));

  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<ExtractedContext>(raw);

  return {
    searchKeyword: (parsed.searchKeyword ?? "").trim().slice(0, 80),
    productType: (parsed.productType ?? "").trim().slice(0, 40),
    audienceHint: (parsed.audienceHint ?? "").trim().slice(0, 80),
    styleHint: (parsed.styleHint ?? "").trim().slice(0, 80),
  };
}

// ─── Tag swap suggestions (Haiku, text-only) ───────────────────────

/**
 * Given an existing tag the user wants to replace (usually because
 * it's saturated/hot or just feels wrong), brainstorm 3 alternatives
 * of similar intent but with different positioning.
 *
 * Used by /api/seo-autopilot/swap-tag.
 */
export interface TagReplacement {
  tag: string;
  reason: string;
}

// Tags Etsy flags as risky / policy-borderline. We drop any
// suggestion that hits one of these so the seller never sees
// suggestions like "sexy lace dress" that could trigger a review.
// Conservative list — only words that are universally risky on
// Etsy regardless of category. "lingerie" / "boudoir" stay because
// they're legitimate Etsy categories.
const RISKY_TAG_PATTERNS = [
  /\b(nude|naked|erotic|porn|xxx|fetish|kink|bdsm)\b/i,
  /\b(sexy|sensual|seductive|provocative|lewd)\b/i,
  /\b(weed|marijuana|cannabis|cocaine|meth|heroin|drug)\b/i,
  /\b(gun|rifle|pistol|firearm|ammo|bullet)\b/i,
  /\b(nazi|swastika|kkk|terrorist)\b/i,
];

function tagLooksRisky(tag: string): boolean {
  return RISKY_TAG_PATTERNS.some((re) => re.test(tag));
}

export async function suggestTagReplacements(
  opts: {
    currentTag: string;
    productTitle: string;
    productType: string;
    category: string;
    existingTags: string[];
    reason?: string;
  },
  accum?: CostAccumulator,
): Promise<TagReplacement[]> {
  const reasonLine = opts.reason
    ? `Reason for swapping: ${opts.reason}`
    : "Reason for swapping: the seller wants a fresh take on this tag (often because it's too saturated to rank for).";

  // Ask Haiku for 10 candidates (was 6). After filtering for length,
  // risky words, near-duplicates of the existing tag list, and
  // low-quality picks, we want 3 strong ones to return. 10 → 3 gives
  // ~3× buffer.
  const msg = await client().messages.create({
    model: MODEL_VALIDATOR, // Haiku — cheap, good at this kind of task
    max_tokens: 900,
    temperature: 0.5,
    system: `You are an Etsy SEO expert. The seller wants to REPLACE one tag — usually because it's saturated (won't rank for a new shop) or off-target. Suggest 10 alternative tags that are GENUINELY DIFFERENT from the tag being replaced AND from every tag already on the listing.

🚫 ABSOLUTE HARD RULE — TAG LENGTH ≤20 CHARACTERS:
Etsy rejects any tag over 20 characters TOTAL (every letter + every space counts). You MUST count characters before outputting. If your candidate is 21+ chars, REWRITE it shorter or pick a completely different tag — NEVER output a tag over 20 chars even partially. Truncated phrases are USELESS to the seller.

Character counting examples (count every char including spaces):
  ✅ "boho earrings" = 13 chars — OK
  ✅ "wooden key holder" = 17 chars — OK
  ✅ "rustic key shelf" = 16 chars — OK
  ❌ "rustic key holder shelf" = 23 chars — TOO LONG, drop or shorten
  ❌ "minimalist gold drop" = 20 chars — OK at exactly 20
  ❌ "wooden wall key storage" = 23 chars — TOO LONG

🚫 ABSOLUTE HARD RULE — NO NEAR-DUPLICATES:
A "near-duplicate" is a tag that shares 2+ significant words with the
tag being replaced OR with any tag already on the listing. Swapping
"mermaid prom dress" for "mermaid prom gown" is NOT a swap — it's the
same keyword in a fancy hat. The seller already has those slots
covered. You MUST pick angles the existing tag set DOESN'T cover.

Examples of bad "swaps" (REJECT these patterns):
  Current: "mermaid prom dress"
  ❌ "mermaid prom gown"      (dress→gown, otherwise identical)
  ❌ "long mermaid dress"     (added one word, same root)
  ❌ "mermaid evening dress"  (same noun, swapped occasion)
  ✅ "lace prom gown"         (different material + same occasion)
  ✅ "fitted bodice gown"     (silhouette angle, no mermaid overlap)
  ✅ "engagement dress"       (different occasion entirely)

🚫 ABSOLUTE HARD RULE — NO DEAD TAGS:
Don't suggest hyper-niche phrases nobody searches ("vintage purple
lavender appliqué gown" is dead, "lavender prom gown" lives). Aim for
tags you'd EXPECT to have 500–10,000 Etsy listings — proven demand.
The seller's pipeline will reject suggestions with <200 actual
listings, so don't waste a slot on something nobody searches.

OTHER RULES:
1. lowercase, no punctuation
2. Cover SIMILAR buyer intent OR a complementary intent that
   broadens the listing's surface area
3. Lean LONGER and more SPECIFIC (long-tail beats short-tail for new
   shops) — but STILL ≤20 chars
4. NO brand names or trademarks (Disney, Marvel, Nike, etc.)
5. NO risky / Etsy-flag words: sexy, sensual, erotic, nude, weed,
   gun, etc. Use neutral descriptors instead.
6. NO buyer-data-on-product wording (we sell ready stock, no input
   field): no "personalized" / "personalised", no "customisable" /
   "customizable", no "monogram" / "monogrammed", no "with name" /
   "your name on". Everything else is fine — handmade, hand knit,
   hand stitched, custom made, made to order, bespoke, engraved are
   all ALLOWED (marketing/feature words, not buyer-data promises).
7. Vary FACETS across the 10 — each candidate should explore a
   different angle. Aim for at least one per facet:
     • material/surface (lace, satin, 3d applique, beaded)
     • color (lilac, lavender, sage, ivory)
     • silhouette (strapless, fitted bodice, A-line)
     • audience (bridesmaid, mother of bride, plus size)
     • occasion (engagement, pageant, gala, quinceanera)
     • length (floor length, midi, mini)
     • style descriptor (vintage, modern, romantic, gothic)

OUTPUT FORMAT — strict JSON, no prose. Output exactly 10 candidates so the seller has options after the demand filter drops the dead ones:
{
  "replacements": [
    { "tag": "...", "reason": "1-line why this is a better choice" },
    { "tag": "...", "reason": "..." },
    ... 10 items total ...
  ]
}`,
    messages: [
      {
        role: "user",
        content: `Product: ${opts.productTitle}
Product type: ${opts.productType}
Category: ${opts.category}

Tag being swapped: "${opts.currentTag}"
${reasonLine}

Existing tag list (don't duplicate any of these):
${opts.existingTags.map((t) => `- ${t}`).join("\n")}

Suggest 6 replacement tags. Remember: every tag must be ≤20 chars. Count carefully before outputting.`,
      },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_VALIDATOR));

  const raw = "{" + extractText(msg);
  try {
    const parsed = safeParseJson<{ replacements: TagReplacement[] }>(raw);
    const existingLower = new Set(
      opts.existingTags.map((t) => t.toLowerCase()),
    );
    const currentLower = opts.currentTag.toLowerCase();

    // Helper — significant words from a tag (3+ chars, no English stop
    // words). Used by the near-duplicate filter below.
    const stopWords = new Set([
      "a", "an", "the", "and", "or", "of", "for", "with", "in",
      "on", "to", "by", "from", "at",
    ]);
    const sigWords = (tag: string): Set<string> => {
      return new Set(
        tag
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !stopWords.has(w)),
      );
    };

    const currentSig = sigWords(opts.currentTag);
    const existingSigs = opts.existingTags.map((t) => sigWords(t));

    // Near-duplicate check: two tags are "near duplicates" if they
    // share 2+ significant words OR if one is a strict substring of
    // the other (e.g., "mermaid dress" ⊂ "long mermaid dress").
    const isNearDup = (candidate: string): boolean => {
      const candLower = candidate.toLowerCase();
      const candSig = sigWords(candLower);

      // vs the tag being replaced
      const overlapWithCurrent = [...candSig].filter((w) =>
        currentSig.has(w),
      ).length;
      if (overlapWithCurrent >= 2) return true;
      if (currentLower.includes(candLower) || candLower.includes(currentLower)) {
        return true;
      }

      // vs every existing tag on the listing
      for (let i = 0; i < existingSigs.length; i++) {
        const overlap = [...candSig].filter((w) =>
          existingSigs[i].has(w),
        ).length;
        if (overlap >= 2) return true;
        const existing = opts.existingTags[i].toLowerCase();
        if (existing.includes(candLower) || candLower.includes(existing)) {
          return true;
        }
      }

      return false;
    };

    // NO MORE TRUNCATION. Previously this was `.slice(0, 20)` which
    // silently chopped "wooden wall key storage" → "wooden wall key stor"
    // — garbage. Now we REJECT anything over 20 chars and rely on the
    // 3× buffer (asking for 10 to land 3) to absorb the loss.
    const cleaned = (parsed.replacements ?? [])
      .map((r) => ({
        tag: (r.tag ?? "")
          .toString()
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "") // Etsy: letters, digits, spaces, hyphens
          .replace(/\s+/g, " ")
          .trim(),
        reason: (r.reason ?? "").toString().trim().slice(0, 150),
      }))
      .filter((r) => {
        if (r.tag.length < 3) return false;
        if (r.tag.length > 20) return false; // ← reject, no truncation
        if (existingLower.has(r.tag)) return false;
        if (r.tag === currentLower) return false;
        if (tagLooksRisky(r.tag)) return false; // sexy/nude/weed/etc.
        if (tagLooksLikeMto(r.tag)) return false; // made-to-order/custom/etc.
        // Drop suggestions that are barely-different rephrases of the
        // existing tag set. Haiku consistently produces these — e.g.
        // "mermaid prom gown" when the listing already has "mermaid
        // prom dress". That's a fake swap; the seller gains nothing.
        if (isNearDup(r.tag)) return false;
        return true;
      });

    // Dedupe within the cleaned set (Haiku sometimes repeats itself)
    const seen = new Set<string>();
    const deduped: TagReplacement[] = [];
    for (const r of cleaned) {
      if (seen.has(r.tag)) continue;
      seen.add(r.tag);
      deduped.push(r);
    }

    return deduped.slice(0, 5);
  } catch {
    return [];
  }
}

// ─── Long-tail keyword brainstorm (Haiku, text-only) ───────────────

/**
 * Brainstorm long-tail search variants for a product. The goal is to
 * surface phrases REAL BUYERS would type into Etsy search — not what
 * competitors wrote in their titles.
 *
 * Output is a string[] of 20-30 candidate phrases. Each is then scored
 * downstream via Etsy demand data (count + top-favs) so we know which
 * are actually trafficked.
 *
 * Used by the SEO Autopilot pipeline as a parallel pass alongside the
 * standard competitor analysis.
 */
export async function expandSearchVariants(
  opts: {
    seedKeyword: string;
    productType: string;
    audienceHint?: string;
    styleHint?: string;
  },
  accum?: CostAccumulator,
): Promise<string[]> {
  const audienceLine = opts.audienceHint
    ? `Target audience hint: ${opts.audienceHint}`
    : "";
  const styleLine = opts.styleHint ? `Style hint: ${opts.styleHint}` : "";

  const msg = await client().messages.create({
    model: MODEL_VALIDATOR, // Haiku — cheap brainstorm
    max_tokens: 600,
    temperature: 0.5,
    system: `You are an Etsy buyer behaviour expert. Given a product, brainstorm 25 long-tail search phrases real buyers would type into Etsy's search bar.

Rules:
1. Each phrase is 2-5 words, lowercase, no punctuation.
2. Cover diverse buyer intents: gifts, occasions, recipients, styles, materials, sizes, use cases.
3. Lean into LONG-TAIL (3-5 words) — those rank easier than single words.
4. Avoid the seed keyword verbatim — vary the wording, add modifiers.
5. NO brand names, NO trademarks (Disney/Nike/Marvel/etc).
6. Mix demand levels: include some obvious popular searches AND some niche/specific ones.
7. Think about WHO buys this product and WHY — friend's wedding gift, father's day, summer vacation, etc.

OUTPUT FORMAT — strict JSON, no prose:
{
  "variants": [
    "phrase 1",
    "phrase 2",
    ... 25 items
  ]
}`,
    messages: [
      {
        role: "user",
        content: `Seed keyword: ${opts.seedKeyword}
Product type: ${opts.productType}
${audienceLine}
${styleLine}

Generate 25 long-tail Etsy search variants.`,
      },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_VALIDATOR));

  const raw = "{" + extractText(msg);
  try {
    const parsed = safeParseJson<{ variants: string[] }>(raw);
    return (parsed.variants ?? [])
      .map((v) => (v ?? "").toString().trim().toLowerCase())
      .filter((v) => v.length >= 3 && v.length <= 80)
      .slice(0, 30);
  } catch {
    return [];
  }
}

/**
 * Niche → Etsy shop categories. Used by the new niche-centric Manual
 * Hunting flow: employee types "boho jewelry", we surface 5-8 actual
 * Etsy shop categories an seller in that niche would have (Earrings,
 * Necklaces, Bracelets, etc.).
 *
 * Returns category names; the caller then runs keyword expansion per
 * category to organize the hunt by shop section.
 */
export async function generateNicheCategories(
  opts: {
    niche: string;
    style?: string;
    audience?: string;
    extras?: string[]; // categories the employee wants to force-include
  },
  accum?: CostAccumulator,
): Promise<string[]> {
  const styleLine = opts.style ? `Style hint: ${opts.style}` : "";
  const audienceLine = opts.audience
    ? `Target audience hint: ${opts.audience}`
    : "";
  const extrasLine = opts.extras?.length
    ? `IMPORTANT — ALSO include these categories the seller specified: ${opts.extras.join(", ")}`
    : "";

  const msg = await client().messages.create({
    model: MODEL_VALIDATOR, // Haiku — cheap brainstorm
    max_tokens: 600,
    temperature: 0.5,
    system: `You are an Etsy/AliExpress dropshipping strategist with deep knowledge of what categories are PROVEN SELLERS on Etsy. Given a niche, output 8-10 CATEGORIES that established Etsy sellers in this niche actually carry.

CRITICAL rules:
1. BE EXHAUSTIVE — cover the FULL breadth of the niche. Don't return 4-6 obvious categories. Top Etsy shops in big niches have 10-15 sections; surface that breadth.
2. Each category must be a PROVEN seller — categories real Etsy shops in this niche organize their inventory around.
3. Categories are SHOP SECTIONS, not specific products.
   ✅ Good: "Earrings", "Graphic Tees", "Wall Art", "Coffee Mugs", "Outerwear", "Hair Accessories"
   ❌ Bad: "Boho Hoop Earrings", "Vintage Style Necklace" (too specific — those are keywords)
4. Each category is 1-3 words, Title Case.
5. Include LESS-OBVIOUS sections that are still proven sellers. Examples:
   - "Boho Jewelry" → also include Body Chains, Anklets, Toe Rings, Belly Chains, Hair Accessories — not just Earrings/Necklaces/Bracelets
   - "Mens Clothing" → also include Outerwear, Activewear, Loungewear, Accessories, Workwear, Streetwear, Underwear, Suits, Coats, Pants, Shorts — not just Tees/Hoodies
   - "Home Decor" → also include Throw Pillows, Wall Hangings, Plant Pots, Mirrors, Candles, Vases, Rugs, Art Prints, Doormats, Storage
6. NO duplicates. NO niche-name repeats.
7. Aim for 6-8 categories — enough breadth to span the niche without diluting quality. Better to have 10 strong sections than 12 with weak ones.

Think: "If I'm starting an Etsy shop in this niche, what are EVERY POSSIBLE shop section I could add to maximize listings + cross-sell? Cover all of them."

OUTPUT FORMAT — strict JSON, no prose:
{
  "categories": ["Category 1", "Category 2", ... 8-10 items]
}`,
    messages: [
      {
        role: "user",
        content: `Niche: ${opts.niche}
${styleLine}
${audienceLine}
${extrasLine}

Return the 5-8 shop categories for this niche.`,
      },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_VALIDATOR));

  const raw = "{" + extractText(msg);
  try {
    const parsed = safeParseJson<{ categories: string[] }>(raw);
    const fromAi = (parsed.categories ?? [])
      .map((c) => (c ?? "").toString().trim())
      .filter((c) => c.length >= 2 && c.length <= 40);
    // Merge in the user's forced extras (deduped, case-insensitive)
    const seen = new Set(fromAi.map((c) => c.toLowerCase()));
    const merged = [...fromAi];
    for (const extra of opts.extras ?? []) {
      const trimmed = extra.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        merged.push(trimmed);
        seen.add(trimmed.toLowerCase());
      }
    }
    // Cap at 8 categories. With 5 keywords each × 2 APIs (Etsy + AE) at
    // shared 3.3 QPS, math becomes 8×5 = 40 keywords × 2 APIs = 80 API
    // calls / 3.3 QPS = ~12s per API in parallel. Plus AE retries on
    // 429s, real-world wall time ~15-20s. Previous 10×8 = 80 keywords
    // pushed wall time to 90+s with retry storms.
    return merged.slice(0, 8);
  } catch {
    return opts.extras ?? [];
  }
}

/**
 * Niche + Category → 4-6 specific search keywords buyers would type.
 *
 * Called once per category in the niche-hunting pipeline. Per category
 * we get 4-6 keywords; 6 categories × 5 keywords = ~30 keywords per
 * niche hunt — organized rather than flat.
 */
export async function generateCategoryKeywords(
  opts: {
    niche: string;
    category: string;
    style?: string;
    audience?: string;
  },
  accum?: CostAccumulator,
): Promise<string[]> {
  const styleLine = opts.style ? `Style: ${opts.style}` : "";
  const audienceLine = opts.audience ? `Audience: ${opts.audience}` : "";

  const msg = await client().messages.create({
    model: MODEL_VALIDATOR, // Haiku
    max_tokens: 700,
    temperature: 0.7,
    system: `You are an Etsy buyer behavior expert. Given a niche + a category within it, brainstorm 8 long-tail search phrases REAL buyers type into Etsy to find products in this category. Cover the FULL breadth of how buyers shop: gifts, occasions, recipients, styles, materials, aesthetics, sizes, use cases.

Mix at least 5 of these intent buckets across the keyword set (don't be one-note):

1. AESTHETIC / STYLE — y2k, indie sleaze, cottagecore, dark academia, mob wife, coastal grandma, soft girl, alt grunge, clean girl, brat summer, vintage 70s, minimalist, maximalist, dopamine, weird girl
2. MATERIAL / FINISH — sterling silver, polymer clay, freshwater pearl, oversized cotton, vintage denim, organic linen, tarnish-free, recycled, hand-stitched, embroidered, distressed, hand-painted
3. OCCASION — wedding, anniversary, birthday, valentine, mother's day, baby shower, bridal, graduation, christmas, halloween, summer festival, everyday, office
4. RECIPIENT — gift for sister, gift for mom, groomsmen, bridesmaid, teen daughter, men, women, boyfriend, husband, dad, mother-in-law
5. PRODUCT SPECIFICS — huggie / drop / stud (jewelry); oversized / cropped / baggy / slim fit (clothing); 3d / embossed / engraved (decor); chunky / dainty / stacked
6. USE CASE — layering, statement piece, everyday, workout, lounging, festival outfit, work-from-home, costume, gym, beach
7. SIZE / FIT (when relevant) — plus size, petite, tall, oversized, slim, mens xxl
8. COLOR / MOTIF — sage green, smoky quartz, butterfly, evil eye, mushroom, snake, chrome, pearl, herbarium, bookshelf

✅ GREAT examples (different niches):

"Earrings" niche:
- y2k butterfly drop earrings
- dainty pearl evil eye studs
- cottagecore mushroom dangle
- groomsmen ear cuff gift
- statement turquoise drops
- minimalist huggie hoop set
- chunky herringbone gold hoops
- gift for sister birthday earrings
- mob wife oversized hoops
- bridesmaid pearl drop set

"Graphic Tees" niche:
- y2k baggy graphic tee oversized fit
- alt grunge distressed skull shirt
- cottagecore mushroom forest tee
- vintage 90s band tour tshirt
- minimalist line art graphic tee
- dad joke pun shirt funny gift
- gym bro lifting heavy graphic tee
- soft girl pastel cherub tee
- bookish dark academia literary tee
- streetwear oversized graphic tee men

"Coffee Mugs" niche:
- sarcastic gen z mug self deprecating
- cottagecore mushroom forest ceramic mug
- gift for boss promotion mug
- minimalist line drawing face mug
- bookish dark academia book stack mug
- y2k bratz nostalgic glossy mug
- handmade speckled glaze coffee mug
- dad joke pun fathers day mug
- horror movie villain enamel camp mug
- valentine couples matching mug set

Rules:
- Each keyword 2-5 words, lowercase, no punctuation, no hashtags
- 100% inside the given category (don't drift to other categories)
- LEAN long-tail (3-5 words) — easier to rank for new shops
- NO brand names or trademarks (Disney, Nike, Marvel, etc.)
- NO duplicates within the set
- NO "[adjective] [category]" generic patterns — make them SPECIFIC
- Mix at least 5 intent buckets across the set so they're not all aesthetic-only or all occasion-only

Think: "10-14 different buyers walked into the Etsy search bar for this category — what did EACH of them type?"

OUTPUT FORMAT — strict JSON, no prose:
{
  "keywords": ["kw 1", "kw 2", ... 8 items]
}`,
    messages: [
      {
        role: "user",
        content: `Niche: ${opts.niche}
Category: ${opts.category}
${styleLine}
${audienceLine}

Generate 8 long-tail keywords for this category. Cover at least 5 different intent buckets (aesthetic / material / occasion / recipient / product specifics / use case). Make them SPECIFIC. No generic "[adjective] [category]" outputs.`,
      },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_VALIDATOR));

  const raw = "{" + extractText(msg);
  try {
    const parsed = safeParseJson<{ keywords: string[] }>(raw);
    return (parsed.keywords ?? [])
      .map((v) => (v ?? "").toString().trim().toLowerCase())
      .filter((v) => {
        if (v.length < 3 || v.length > 80) return false;
        const words = v.split(/\s+/);
        if (words.length < 2) return false;
        // Allow 2-word outputs unless they're pure "[adj] [category]"
        // basics — e.g. ban "boho earrings" but allow "evil eye".
        if (words.length === 2) {
          const cat = opts.category.toLowerCase();
          if (cat.includes(words[1]) || cat.includes(words[0])) return false;
        }
        return true;
      })
      // Cap at 5 keywords per category. 8 cats × 5 = 40 keywords ×
      // 2 APIs in parallel = ~12s wall time. Was 8 keywords; user
      // reported 2+ minute hunts because of AE rate-limit retry
      // storms with 80+ keywords.
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Niche → full breakdown in ONE Haiku call.
 *
 * Replaces the previous 11-call pipeline (1 categories + 10 keywords-
 * per-category) with a single fat call that returns both the category
 * list AND the keywords for each in one shot. Cost dropped ~6x:
 *
 *   Old: ~$0.020 per hunt (11 calls × ~$0.002 each)
 *   New: ~$0.003 per hunt (1 call with bigger output)
 *
 * Same quality — Haiku has the full niche context for every keyword,
 * which arguably IMPROVES coherence vs. isolated per-category calls.
 */
export interface NicheBreakdownCategory {
  category: string;
  keywords: string[];
  /**
   * Single-word product noun stems that should appear in a real product
   * title for this category. Used downstream to filter out off-topic
   * AliExpress matches — e.g. for category "Outerwear", anchors
   * ["jacket", "coat", "blazer"] reject mom-gift mugs that AE returns
   * because the query contained "for mom".
   */
  productAnchors: string[];
}

/**
 * Stop-word list used when deriving anchors from category names —
 * connectors / fillers that shouldn't become product-title anchors.
 */
const CATEGORY_NAME_STOP_WORDS = new Set([
  "and", "the", "for", "with", "of", "in", "on", "to", "by", "or",
  "a", "an", "is", "are", "&", "set", "sets", "all",
]);

/**
 * Gender-qualifier mapping: if the niche contains any of the trigger
 * words, ALL generated keywords MUST contain at least one of the
 * matching enforcement tokens. Hard-coded post-filter backstop in
 * case Haiku drifts.
 */
const GENDER_ENFORCEMENT: Array<{
  triggers: string[];
  requiresAny: string[];
}> = [
  {
    triggers: ["mens", "men's", "men", "male", "boys", "boyfriend"],
    requiresAny: ["men", "male", "boy", "his", "groom", "husband", "boyfriend", "dad", "father"],
  },
  {
    triggers: ["womens", "women's", "women", "female", "girls", "girlfriend"],
    requiresAny: ["women", "female", "girl", "her", "bride", "wife", "girlfriend", "mom", "mother", "lady", "ladies"],
  },
  {
    // The baby/kid bucket needs to be permissive — for niches like
    // "Newborn baby clothing", Haiku naturally writes keywords using
    // "newborn" or "preemie" alone (e.g. "newborn cotton onesie",
    // "preemie hat soft") without also saying "baby". Previously
    // those got filtered out because "newborn" and "preemie" weren't
    // in requiresAny, leaving categories like Hats & Mittens with
    // just 1 keyword instead of 5-6. Both terms are now accepted.
    triggers: [
      "kids", "children", "child", "toddler",
      "baby", "infant", "newborn", "preemie", "preemies",
    ],
    requiresAny: [
      "kid", "children", "child", "toddler",
      "baby", "infant", "newborn", "preemie", "nursery",
    ],
  },
];

/**
 * Find any gender-qualifier rules that apply to this niche.
 * Returns the list of "requires" tokens that keywords must contain at
 * least one of, OR empty array if niche has no gender constraint.
 */
function getNicheGenderRequirements(niche: string): string[] {
  const nicheLower = " " + niche.toLowerCase() + " ";
  for (const rule of GENDER_ENFORCEMENT) {
    for (const trigger of rule.triggers) {
      // Check for trigger as a whole word (padded with spaces)
      if (
        nicheLower.includes(` ${trigger} `) ||
        nicheLower.includes(` ${trigger}'`) ||
        nicheLower.startsWith(`${trigger} `) ||
        nicheLower.endsWith(` ${trigger}`)
      ) {
        return rule.requiresAny;
      }
    }
  }
  return [];
}

function keywordMatchesGenderRequirement(
  keyword: string,
  requiresAny: string[],
): boolean {
  if (requiresAny.length === 0) return true;
  const kwLower = keyword.toLowerCase();
  return requiresAny.some((tok) => kwLower.includes(tok));
}

/**
 * Pick a single tag-friendly prefix token to inject into keywords
 * that don't yet contain the niche's required market-segment word.
 * Returns the buyer-searchable form ("womens" / "mens" / "kids"),
 * NOT the broader pronouns ("her" / "his" / "their") which would
 * read weirdly as a keyword prefix.
 *
 * Drives the auto-prepend behaviour in generateNicheBreakdown.
 */
function canonicalGenderPrefix(requiresAny: string[]): string | null {
  if (requiresAny.length === 0) return null;
  const set = new Set(requiresAny);
  // Order matters — pick the most natural-sounding prefix first.
  if (set.has("women") || set.has("lady") || set.has("ladies")) return "womens";
  if (set.has("men") || set.has("male")) return "mens";
  if (
    set.has("kid") ||
    set.has("children") ||
    set.has("child") ||
    set.has("toddler") ||
    set.has("baby") ||
    set.has("infant") ||
    set.has("newborn") ||
    set.has("preemie")
  ) {
    return "kids";
  }
  return null;
}

/**
 * Extract product-anchor stems from a category name. Splits on any
 * non-alphanumeric chars + filters stop words + trims plural/derived
 * suffixes to short stems so AE title `includes()` substring matching
 * catches common variants.
 *
 *   "Masks & Face Accessories"  → ["mask", "face", "accessor"]
 *   "Coffee Mugs"               → ["coffee", "mug"]
 *   "Hair Accessories"          → ["hair", "accessor"]
 *   "Wall Art"                  → ["wall", "art"]
 *   "Outerwear"                 → ["outerwear"]
 *   "Graphic Tees"              → ["graphic", "tee"]
 */
function deriveAnchorsFromCategoryName(name: string): string[] {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !CATEGORY_NAME_STOP_WORDS.has(w));
  const stems: string[] = [];
  for (const w of words) {
    // Trim common plural / -y / -ie endings to get a substring stem
    // that catches both singular and plural product titles.
    if (w.endsWith("ies") && w.length > 4) stems.push(w.slice(0, -3));
    else if (w.endsWith("ses") && w.length > 4) stems.push(w.slice(0, -2));
    else if (w.endsWith("es") && w.length > 4) stems.push(w.slice(0, -1));
    else if (w.endsWith("s") && w.length > 3) stems.push(w.slice(0, -1));
    else stems.push(w);
  }
  return Array.from(new Set(stems));
}

export async function generateNicheBreakdown(
  opts: {
    niche: string;
    style?: string;
    audience?: string;
    extras?: string[]; // categories the employee wants to force-include
  },
  accum?: CostAccumulator,
): Promise<NicheBreakdownCategory[]> {
  const styleLine = opts.style ? `Style hint: ${opts.style}` : "";
  const audienceLine = opts.audience
    ? `Audience hint: ${opts.audience}`
    : "";
  const extrasLine = opts.extras?.length
    ? `IMPORTANT — ALSO include these categories the seller specified: ${opts.extras.join(", ")}`
    : "";

  // When both a gender requirement AND a style/audience modifier are
  // present (e.g. niche="Women Leather", style="Gothic",
  // audience="Halloween"), Haiku tends to drift onto the modifiers and
  // skip the gender token in every keyword. Add an in-line reminder
  // so it doesn't have to remember the system-prompt rule. The post-
  // filter auto-prepends a fallback token anyway, but reducing the
  // need for that means cleaner, more search-friendly phrasing
  // (`gothic womens leather jacket` reads worse than
  // `womens gothic leather jacket`).
  const nicheGenderRequirements = getNicheGenderRequirements(opts.niche);
  const hasModifiers = !!opts.style || !!opts.audience;
  const genderReminder =
    nicheGenderRequirements.length > 0 && hasModifiers
      ? `⚠ REMINDER: This niche is gender-scoped (${nicheGenderRequirements.slice(0, 3).join(" / ")}). Style and audience modifiers DO NOT replace the gender requirement — EVERY keyword must still contain a gender token, even when combined with style or audience.`
      : "";

  const msg = await client().messages.create({
    model: MODEL_VALIDATOR, // Haiku — single call
    max_tokens: 2500,
    temperature: 0.6,
    system: `You are an Etsy SEO + dropshipping strategist. Given a niche, output 6-8 proven-selling CATEGORIES, and for EACH category: 3-5 product-anchor words + 5 long-tail buyer-intent KEYWORDS.

CATEGORIES — rules:
- Be EXHAUSTIVE. Cover the full breadth of the niche, including less-obvious sections proven Etsy shops in the niche actually carry.
  • "Mens Clothing" → Graphic Tees, T-Shirts, Hoodies, Sweatshirts, Joggers, Sweatpants, Outerwear, Activewear, Loungewear, Accessories (10)
  • "Boho Jewelry" → Earrings, Necklaces, Bracelets, Rings, Body Chains, Anklets, Toe Rings, Hair Accessories (8)
  • "Home Decor" → Wall Art, Throw Pillows, Candles, Vases, Mirrors, Plant Pots, Rugs, Doormats, Curtains (9)
- Each category 1-3 words, Title Case
- NO duplicates, NO niche-name repeats

🚫 NICHE FIDELITY — ABSOLUTE RULE:
If the niche contains a GENDER or AUDIENCE qualifier, EVERY single keyword across ALL categories MUST contain that qualifier. NO exceptions. The user is searching for ONE specific market segment.

  • Niche "mens linen clothing"  → EVERY keyword must include "men" or "mens" or "male" or "for him". Drop keywords without.
  • Niche "womens jewelry"       → EVERY keyword must include "women" or "womens" or "female" or "for her".
  • Niche "kids clothing"        → EVERY keyword must include "kids" or "children" or "boys" or "girls" or "toddler".
  • Niche "boho jewelry"         → no gender constraint (niche has no gender)

Examples for niche "mens linen clothing":
  ✅ "mens linen button down shirt"
  ✅ "linen pants for men summer"
  ✅ "casual linen shirt mens beach"
  ❌ "linen long sleeve shirt"  (gender ambiguous — sounds womens-default)
  ❌ "women linen blouse"       (WRONG GENDER)
  ❌ "linen pants summer"       (no gender at all)

Same rule applies to OTHER strict niche qualifiers (material like "linen", style like "y2k", aesthetic like "cottagecore") — keep them threaded through keywords so AliExpress doesn't drift the search.

PRODUCT ANCHORS — rules (per category):
5-8 single-word product noun stems / SYNONYMS that buyers AND AliExpress sellers actually use in titles for this category. Include common alternatives so we don't miss valid products.
  • "Outerwear"     → ["jacket", "coat", "blazer", "parka", "vest", "windbreaker", "anorak"]
  • "Earrings"      → ["earring", "stud", "hoop", "drop", "dangle", "ear cuff", "huggie"]
  • "Necklaces"     → ["necklace", "pendant", "choker", "chain", "lariat"]
  • "Wall Art"      → ["print", "poster", "canvas", "painting", "art", "wall hanging", "tapestry"]
  • "Coffee Mugs"   → ["mug", "cup", "tumbler", "stein", "tankard"]
  • "Mens Shirts"   → ["shirt", "tee", "polo", "t-shirt", "buttondown", "top"]
  • "Graphic Tees"  → ["tee", "t-shirt", "shirt", "top", "vintage tee"]
- Lowercase, singular preferred (we substring-match against titles)
- Include common SYNONYMS — what other words might appear in a title for this same product? (tee/shirt/top all describe a t-shirt; jacket/coat/blazer all are outerwear)
- These are the HARD MATCH gate — products without any of these in their title get filtered out

KEYWORDS — CRITICAL rules:
- 7 long-tail (3-5 word) search phrases real buyers type into Etsy
- Each keyword MUST have a clear single PRODUCT NOUN — same product type as the category.
  ✅ "hand stitched mens jacket"  — clear product (jacket)
  ❌ "hand stitched jacket gift for mom" — mixes "jacket" with "gift for mom"; AliExpress matches "gift for mom" and returns generic mom-gifts instead of jackets
  ❌ "moms day birthday gift" — no product noun at all
  ❌ "anniversary gift for husband" — no product noun
- If you want to express a recipient/occasion, attach it as MODIFIERS to the product:
  ✅ "mom mothers day jacket"
  ✅ "anniversary gift bracelet"  (when category is Bracelets)
  ✅ "groomsmen leather wallet"  (when category is Wallets)
- Cover at least 3 of these intent buckets across the 5 keywords:
  1. Aesthetic — y2k, indie sleaze, cottagecore, dark academia, mob wife, coastal grandma, soft girl, alt grunge, clean girl, brat summer, minimalist
  2. Material/Finish — sterling silver, polymer clay, freshwater pearl, vintage denim, organic linen, hand-stitched, hand-knit, embroidered, distressed, ribbed, knit, woven (handcraft descriptors are FINE — they're marketing language matching the actual product look)
  3. Occasion — wedding, anniversary, birthday, valentine, baby shower, bridal, graduation, christmas, summer festival, everyday
  4. Recipient — sister, mom, groomsmen, bridesmaid, teen, men, women, boyfriend, dad
  5. Product Specifics — huggie, drop, stud (jewelry); oversized, cropped, baggy, slim fit (clothing); 3d, embossed (decor)
  6. Use Case — layering, statement, everyday, workout, festival, work-from-home, gym
  7. Size/Fit — plus size, petite, tall, oversized, slim
  8. Color/Motif — sage green, butterfly, evil eye, mushroom, snake, chrome, pearl
- 2-5 words, lowercase, no punctuation
- NO "[adjective] [category]" generic patterns (e.g. don't return "boho earrings" if category is Earrings)
- NO brand names or trademarks (Disney, Nike, etc.)
- NO duplicates

🚫 NO BUYER-DATA-ON-PRODUCT WORDING:
META7MEDIA ships ready-stock from a supplier — there is NO input
field where the buyer types their own name, date, or message. Etsy
flags listings that promise these. NEVER include keywords like:
  ❌ "personalized" / "personalised" / "personalisation"
  ❌ "customisable" / "customizable" / "customization"
  ❌ "monogram" / "monogrammed" (= buyer's initials)
  ❌ "with name" / "with your name" / "printed with name"
  ❌ "your name on" / "name on it"

EVERYTHING ELSE IS FINE. These are marketing/material descriptors,
not buyer-data promises:
  ✅ "handmade" / "hand-crafted" / "hand knit" / "hand stitched" / "hand sewn"
  ✅ "custom made" / "custom order" / "custom sized" / "custom fit" — marketing
  ✅ "made to order" / "MTO" — marketing wording
  ✅ "bespoke" — premium-feel descriptor
  ✅ "engraved" — product can ship with pre-engraved decorative designs

If you want to convey gift-personalization vibes safely, use words
that don't imply buyer-supplied text:
  ✅ "keepsake" / "memento" / "heirloom" — sentimental without input promise

OUTPUT FORMAT — strict JSON, no prose:
{
  "categories": [
    {
      "name": "Category 1",
      "productAnchors": ["anchor1", "anchor2", "anchor3"],
      "keywords": ["kw1", "kw2", "kw3", "kw4", "kw5", "kw6", "kw7"]
    },
    ... 6-8 categories
  ]
}`,
    messages: [
      {
        role: "user",
        content: `Niche: ${opts.niche}
${styleLine}
${audienceLine}
${extrasLine}
${genderReminder}

Return 6-8 proven-selling categories, each with exactly 7 long-tail buyer-intent keywords. Mix 3+ intent buckets across each category's keywords.`,
      },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_VALIDATOR));

  const raw = "{" + extractText(msg);
  try {
    const parsed = safeParseJson<{
      categories: Array<{
        name: string;
        productAnchors?: string[];
        keywords: string[];
      }>;
    }>(raw);
    const cats = parsed.categories ?? [];

    const seenCats = new Set<string>();
    const result: NicheBreakdownCategory[] = [];

    // Gender / audience enforcement — if niche specifies a market segment
    // (mens / womens / kids), every keyword must contain a matching token.
    // Hard backstop in case Haiku drifts.
    const genderRequirements = getNicheGenderRequirements(opts.niche);
    let droppedForGender = 0;

    for (const c of cats) {
      const name = (c?.name ?? "").toString().trim();
      if (!name || name.length < 2 || name.length > 40) continue;
      const lowerName = name.toLowerCase();
      if (seenCats.has(lowerName)) continue;
      seenCats.add(lowerName);

      const anchors = (c?.productAnchors ?? [])
        .map((a) => (a ?? "").toString().trim().toLowerCase())
        .filter((a) => a.length >= 3 && a.length <= 30)
        .slice(0, 10);

      const kws = (c?.keywords ?? [])
        .map((k) => (k ?? "").toString().trim().toLowerCase())
        .filter((k) => {
          if (k.length < 3 || k.length > 80) return false;
          const words = k.split(/\s+/);
          if (words.length < 2) return false;
          // 2-word redundancy check — drop only when BOTH words appear
          // in the category name (= the keyword is just the category
          // restated, e.g. "boho earrings" under cat "Boho Earrings").
          // The earlier OR check was way too broad — for cat
          // "Earrings" it killed every legit 2-word phrase like
          // "tribal earrings" / "stud earrings", which is why categories
          // were rendering with only 3 keywords instead of the 5-7
          // Haiku returned.
          if (words.length === 2) {
            const cat = name.toLowerCase();
            if (cat.includes(words[0]) && cat.includes(words[1])) return false;
          }
          // Buyer-data-on-product backstop — META7MEDIA ships ready-
          // stock with no input field for buyer text. Keywords that
          // promise personalisation / customisation / monogram are
          // TOS-risky on Etsy. Custom made / made-to-order / bespoke
          // / engraved / handmade are NOT banned — those are
          // marketing words. See MTO_PATTERNS comment for full policy.
          if (tagLooksLikeMto(k)) return false;
          return true;
        })
        // Gender / audience enforcement — instead of dropping keywords
        // that don't mention the niche's market segment, AUTO-PREPEND
        // the canonical token so the hunt for AE products still scopes
        // to the right gender. Previously this filter dropped on
        // mismatch; for a niche like "Women Leather" + style "Gothic"
        // + audience "Halloween", Haiku produced keywords like "gothic
        // leather jacket" that lacked any women token — every one got
        // dropped, every category went empty, and the result was 0
        // categories total. The CEO hit this May 20 2026.
        //
        // Map the niche's first-listed enforcement token (e.g. "women",
        // "men", "kids") to a tag-friendly prefix and inject it when
        // missing. Drops only when prepending would exceed Etsy's 80-
        // char keyword cap.
        .map((k) => {
          if (genderRequirements.length === 0) return k;
          if (keywordMatchesGenderRequirement(k, genderRequirements)) return k;
          const prefix = canonicalGenderPrefix(genderRequirements);
          if (!prefix) return k;
          const prefixed = `${prefix} ${k}`;
          if (prefixed.length > 80) {
            droppedForGender++;
            return null;
          }
          return prefixed;
        })
        .filter((k): k is string => k !== null)
        // Cap at 6 final keywords per category. Asked Haiku for 7 to
        // leave a 1-2 keyword buffer against filter drops, but we
        // want a consistent visual density in the UI so the cap is 6.
        .slice(0, 6);

      if (kws.length === 0) continue;

      // ALWAYS merge category-name-derived anchors with Haiku's.
      // The category name itself usually contains the most reliable
      // anchor words. E.g. "Masks & Face Accessories" yields anchors
      // ["mask", "face", "accessor"] which match AE titles like
      // "Halloween Face Mask Cosplay" reliably.
      const nameDerivedAnchors = deriveAnchorsFromCategoryName(name);
      const allAnchors = Array.from(new Set([...anchors, ...nameDerivedAnchors]));

      result.push({
        category: name,
        keywords: kws,
        productAnchors: allAnchors.length > 0 ? allAnchors : [lowerName],
      });
    }

    // Force-include employee extras
    for (const extra of opts.extras ?? []) {
      const trimmed = extra.trim();
      if (trimmed && !seenCats.has(trimmed.toLowerCase())) {
        const lower = trimmed.toLowerCase();
        const derived = deriveAnchorsFromCategoryName(trimmed);
        result.push({
          category: trimmed,
          keywords: [trimmed],
          productAnchors: derived.length > 0 ? derived : [lower],
        });
        seenCats.add(lower);
      }
    }

    if (genderRequirements.length > 0 && droppedForGender > 0) {
      console.log(
        `[generateNicheBreakdown] gender filter dropped ${droppedForGender} keywords (niche: "${opts.niche}", required-any: [${genderRequirements.join(", ")}])`,
      );
    }

    return result.slice(0, 12);
  } catch {
    return [];
  }
}

// ─── Optional — Category classifier (Haiku, text-only) ──────────────

/**
 * Pick the best Etsy taxonomy node from a candidate list.
 *
 * This is the LAST-RESORT category picker — only called when both the
 * "tally taxonomy_id from ranking listings" and "fuzzy match by name"
 * strategies fail. Given a small candidate set (we send level-1 and
 * level-2 nodes that share words with the product description), Haiku
 * picks the most appropriate node.
 *
 * Returns null if Haiku can't decide.
 */
export async function pickCategoryFromCandidates(
  opts: {
    title: string;
    productType: string;
    candidates: Array<{ id: number; name: string; path: string }>;
  },
  accum?: CostAccumulator,
): Promise<number | null> {
  if (opts.candidates.length === 0) return null;

  const numbered = opts.candidates
    .slice(0, 40)
    .map((c, i) => `${i + 1}. [id=${c.id}] ${c.path}`)
    .join("\n");

  const msg = await client().messages.create({
    model: MODEL_VALIDATOR,
    max_tokens: 100,
    temperature: 0,
    system: `You are an Etsy category classifier. Given a product and a numbered list of Etsy taxonomy categories, pick the ONE that best fits. Output strict JSON: {"id": <taxonomy_id>}. If none fit at all, output {"id": null}.`,
    messages: [
      {
        role: "user",
        content: `Product title: ${opts.title}
Product type: ${opts.productType}

Candidate Etsy categories:
${numbered}

Pick the best-fitting category id.`,
      },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_VALIDATOR));

  const raw = "{" + extractText(msg);
  try {
    const parsed = safeParseJson<{ id: number | null }>(raw);
    if (typeof parsed.id === "number" && parsed.id > 0) {
      return parsed.id;
    }
  } catch {
    return null;
  }
  return null;
}

// ─── Stage 1 — Vision compliance gate (Sonnet, strict) ──────────────

export interface ComplianceVerdict {
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  concerns: Array<{
    severity: "block" | "warn";
    category: "trademark" | "prohibited" | "counterfeit" | "policy" | "quality";
    details: string;
  }>;
  summary: string;
}

const COMPLIANCE_SYSTEM = `You are a STRICT Etsy listing compliance officer at META7MEDIA. Looking at product images + title, decide if this product can be legally listed on Etsy without getting taken down or earning a shop strike.

Be conservative — when in doubt, lean BLOCKED. A single trademark slip costs the seller their entire shop. Better to flag a borderline case than miss a real violation. Your job is to PROTECT the shop, not to be permissive.

============================================================
BLOCKED categories — ANY ONE of these = automatic BLOCK
============================================================

TRADEMARK / COPYRIGHT visible on the product itself:
  • Disney IP: Mickey, Minnie, Donald, Frozen (Anna, Elsa, Olaf), Toy Story, Cars, Princess line, Star Wars (any character or vehicle), all Pixar
  • Marvel / DC: Spider-Man, Iron Man, Captain America, Hulk, Avengers, Batman, Superman, Wonder Woman, etc.
  • Nintendo / Pokemon: Mario, Luigi, Yoshi, Zelda, Link, Pikachu, Charizard, all Pokemon characters
  • Other video game IP: Sonic, Minecraft characters/skins, Among Us, Fortnite skins, Roblox
  • Sports leagues: NFL, NBA, MLB, NHL, FIFA team names and logos; Olympic rings; college/university logos
  • Branded fonts or logos: Nike swoosh, Adidas stripes, Apple logo, Coca-Cola script, Louis Vuitton monogram
  • Music acts / record labels: band names + logos (Beatles, Rolling Stones, Taylor Swift face/likeness, BTS, etc.)
  • TV / film: Friends, Game of Thrones, Harry Potter, Lord of the Rings, anime franchises (Naruto, One Piece, Dragon Ball)
  • Real celebrities: photos or likenesses of named real people (Taylor Swift, Beyoncé, Trump, etc.)
  • Religious institutions where trademarked (e.g. Vatican branding, official Bible publisher marks)

COUNTERFEIT / REPLICA:
  • Designer brand copies: fake Gucci, Louis Vuitton, Chanel, Rolex, Cartier, Tiffany, Hermes, Burberry, Prada, Versace
  • "Inspired by" goods that closely mimic a brand's signature design
  • Knockoff jewelry mimicking Cartier Love bracelets, Van Cleef Alhambra, Pandora charms
  • Replica sneakers (fake Yeezys, Jordans, etc.)

PROHIBITED ITEMS per Etsy policy:
  • Weapons: firearms, ammunition, switchblades, brass knuckles, knives marketed as weapons
  • Drugs / drug paraphernalia, regulated wellness products (CBD/THC without proper paperwork)
  • Hazardous materials: chemicals, certain magnets (high-strength neodymium), asbestos
  • Currency, financial instruments, lottery tickets, gift cards as resale items
  • Live animals, human remains, taxidermy without permits
  • Recalled goods or items required to be recalled
  • Stolen items or items from illegal sources
  • Medical devices that require FDA clearance (test strips, glucose monitors, etc.)
  • Tobacco products, e-cigarettes (region-restricted)

ADULT / EXPLICIT content in non-adult Etsy categories. Mature-themed handmade work has its own category — but explicit content NEVER goes in regular categories.

============================================================
REVIEW — flag but allow
============================================================

  • Borderline "inspired by" wording (parody, fan-art styled designs without direct logo / character copying)
  • Quality concerns (visibly low-resolution, blurry, or unprofessional photos)
  • Vague trademark proximity (generic Mickey-Mouse-ish ear shapes without direct character)
  • Designs that LOOK like they might infringe but you're not certain
  • Product description that hints at IP but the image is clean

============================================================
ALLOWED — green light
============================================================

  • Clean, non-branded product photos
  • Generic designs without IP
  • Handmade-style or vintage items in approved categories
  • Standard craft supplies, jewelry-making components, art supplies
  • Original artwork in non-IP genres
  • Fashion items without brand markings

============================================================
OUTPUT FORMAT — strict JSON, NO prose before/after, NO markdown fences
============================================================

{
  "verdict": "ALLOWED" | "REVIEW" | "BLOCKED",
  "concerns": [
    {
      "severity": "block" | "warn",
      "category": "trademark" | "prohibited" | "counterfeit" | "policy" | "quality",
      "details": "Specific 1-sentence reason citing what you saw in the image or title."
    }
  ],
  "summary": "1-sentence verdict: 'Cleared to list — clean generic [product]' OR 'Do NOT list — [specific reason].'"
}

If verdict is ALLOWED, "concerns" may be an empty array. If BLOCKED, every blocking concern MUST have severity "block". Each "details" field should be specific enough that the seller knows EXACTLY what part of the product or title triggered the concern.`;

export async function checkProductCompliance(
  opts: {
    title: string;
    images: ImagePayload[];
  },
  accum?: CostAccumulator,
): Promise<ComplianceVerdict> {
  const { title, images } = opts;

  // Build a multimodal content array: images first, then the text prompt.
  const userContent: ContentBlock[] = [];

  if (images.length > 0) {
    userContent.push(...toImageBlocks(images));
  }

  userContent.push({
    type: "text",
    text: `Product title (from AliExpress / source):
${title}

Review the product image(s) above and the title. Decide whether this product is allowed on Etsy. Be strict — if you can see ANY trademark, IP, or prohibited element, BLOCK it.`,
  });

  const msg = await client().messages.create({
    model: MODEL_COMPLIANCE,
    max_tokens: 800,
    temperature: 0,
    // System prompt is large + static (~2.5k tokens) → cache it. First
    // call writes the cache (~25% surcharge), every subsequent call
    // within 5 min reads it at ~10% of nominal input cost. Even on Haiku
    // the static prompt benefits — saves ~$0.002 per warm call.
    system: [
      {
        type: "text",
        text: COMPLIANCE_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: userContent },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_COMPLIANCE));

  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<ComplianceVerdict>(raw);

  // Normalize verdict to one of three known values.
  const v = (parsed.verdict ?? "").toUpperCase();
  const verdict: ComplianceVerdict["verdict"] =
    v === "BLOCKED" ? "BLOCKED" : v === "REVIEW" ? "REVIEW" : "ALLOWED";

  return {
    verdict,
    concerns: (parsed.concerns ?? []).map((c) => ({
      severity: c.severity === "block" ? "block" : "warn",
      category:
        c.category === "trademark" ||
        c.category === "prohibited" ||
        c.category === "counterfeit" ||
        c.category === "policy" ||
        c.category === "quality"
          ? c.category
          : "policy",
      details: (c.details ?? "").toString().trim(),
    })),
    summary: (parsed.summary ?? "").toString().trim(),
  };
}

// ─── Stage 2 — Listing generation (Sonnet, vision) ──────────────────

export interface GenerationInput {
  /** The AliExpress title (or any product description). Used as the primary cue. */
  productBrief: string;
  /** Up to 2 regenerated product images. */
  images: ImagePayload[];
  /** Confirmed Etsy taxonomy node we're targeting. */
  category: { id: number; name: string; path: string };
  /** Live ranking-1..20 competitors for our keyword. */
  competitors: CompetitorBrief[];
  /** High-frequency phrases + tags extracted from the competitors. */
  anchorKeywords: AnchorKeywords;
  /**
   * Long-tail buyer-search variants brainstormed by Haiku. Raw phrases
   * only — we used to score each against Etsy demand, but the demand
   * step cost 25 Etsy API calls per gen (64% of the daily quota) for
   * marginal SEO gain. Sonnet still uses these as alternative-angle
   * inspiration alongside the proven anchor keywords above.
   */
  buyerVariants: string[];
  /** Audience / style hints (from Stage 0). */
  audience?: string;
  style?: string;
  /** Optional employee-provided variations. */
  sizes?: string[];
  /** "Variants" — covers colors, phone models, designs, anything. */
  variants?: string[];
  /**
   * Reframe constraints — only set when the rule engine OR vision
   * compliance flagged the product (IP / brand / commodity tells /
   * personalisation wording). When present, Sonnet must:
   *   - never include any of `avoidWords` in title, tags, or description
   *   - follow `listingApproach` for the overall framing
   *   - follow `titleGuidance` / `tagGuidance` / `descriptionGuidance`
   * The hard-block list (firearms, drugs, hate, adult, PPE, animals)
   * never reaches this point — those products short-circuit upstream.
   */
  reframeConstraints?: {
    listingApproach: string;
    titleGuidance: string[];
    tagGuidance: string[];
    descriptionGuidance: string[];
    avoidWords: string[];
  };
}

export interface GeneratedListing {
  title: string;
  description: string;
  tags: string[]; // exactly 13
  altTexts: string[]; // EXACTLY 1 item — one general alt text for the whole listing (seller pastes it onto every image)
  rationale: {
    keywordFocus: string;
    titleStrategy: string;
    audienceHook: string;
  };
}

const GENERATOR_SYSTEM = `You are an elite Etsy SEO copywriter at META7MEDIA. You see product images + title + live ranking-listing data + ANCHOR KEYWORDS annotated with live Etsy demand. Your job: produce a complete, ORIGINAL Etsy listing that beats top-20 competitors at their own ranking game by exploiting Etsy's algorithm + observed buyer-search behavior.

═══════════════════════════════════════════════════════════════
ETSY RANKING SIGNAL WEIGHTS (most → least)
═══════════════════════════════════════════════════════════════
1. Title — especially chars 0-40 (highest weight zone)
2. Tags — exact match > partial match
3. Attributes — covered slots boost ranking
4. Description — long-tail keyword surface
5. Materials field — minor but free signal

═══════════════════════════════════════════════════════════════
ANCHOR KEYWORDS — STRICT BY DESTINATION
═══════════════════════════════════════════════════════════════

The user prompt's ANCHOR KEYWORDS block carries live Etsy demand on
every entry:
  ✗ SATURATED  ≥50k listings
  ⚠ HOT         10k–50k
  ✓ MODERATE   1k–10k
  ★ NICHE      <1k

USAGE DIFFERS BY DESTINATION:

TITLE — ALL tiers allowed.
  ✗ Saturated anchors in the TITLE are NOT wasted — they still help
  Etsy match long-tail buyer queries that contain them. Front-load
  one strong anchor (saturated or hot) + product noun in chars 0-40.
  Skipping anchor keywords entirely is leaving free ranking signal
  on the floor.

TAGS — STRICT. ✗ SATURATED anchors are NEVER used as standalone tags.
  Wasted slot — new shops can't rank against 50k+ competing listings.
  ⚠ HOT anchors allowed sparingly (max 2-3 across the 13 tags).
  ✓ MODERATE + ★ NICHE are your primary picks for tag slots.

  When the anchors are mostly ✗ SATURATED (common for mature
  categories like leather bags, jewelry, wallets), generate your OWN
  niche/moderate compounds by appending qualifiers to the saturated
  noun:
    ✗ "leather bag" → ✓ "vegan leather laptop bag"
                    → ✓ "small leather work bag"
                    → ★ "leather diaper changing bag"
                    → ★ "leather pencil case organiser"
    ✗ "crossbody bag" → ✓ "small crossbody travel bag"
                      → ★ "anti theft crossbody phone bag"
                      → ★ "vegan crossbody concert bag"

  Qualifiers that turn saturated → niche:
    • Material modifier (vegan, italian, hammered, embossed)
    • Audience (for nurses, for teachers, for working moms)
    • Use case (laptop, work, diaper, concert, festival)
    • Feature (anti theft, rfid blocking, convertible)
    • Size (small, mini, oversized)

DESCRIPTION — ALL tiers allowed.
  Weave 3-5 anchor keywords naturally into Section 3 (use cases).
  This is your long-tail keyword surface for terms that didn't fit
  the title or tag slots.

═══════════════════════════════════════════════════════════════
TITLE FORMULA (mandatory)
═══════════════════════════════════════════════════════════════

Char layout — Etsy weights chars 0-40 the most heavily:
  0-40    → [PRIMARY ANCHOR] + [PRODUCT NOUN]
  41-100  → " | " + [SECONDARY ANCHORS — 2-4 words each]
  101-140 → " | " + [AUDIENCE / OCCASION HOOK]

Total length: 110-140 chars. Longer = more keyword surface.
Separators: " | " or " · " ONLY. NEVER commas (commas split phrases
in Etsy's matcher).

Audience / occasion hooks (good examples):
  "Gift for Her", "Bridesmaid Dress", "Wedding Guest Style",
  "Prom Night Outfit", "Date Night Look", "Holiday Party Dress",
  "Christmas Gift for Mom", "Mother's Day Gift"

NEVER copy a competitor's title verbatim — produce ORIGINAL English
that captures the same buyer intent.

BANNED in title — buyer-data-on-product wording. There's no input
field for the buyer to type their own name/date/message, so promising
it would mislead:
  ✗ Personalized · Personalised · Personalisation
  ✗ Customisable · Customizable · Customization
  ✗ Monogram · Monogrammed
  ✗ With Name · With Your Name · Printed With Name · Name On It

ALLOWED — these are marketing/material/craft words, NOT buyer-data
promises. Use them freely if they fit the product:
  ✓ Handcraft: Handmade · Hand-Crafted · Hand Knit · Hand Stitched
  ✓ Production: Custom Made · Custom Order · Custom Sized · Custom
    Fit · Made to Order · MTO
  ✓ Premium: Bespoke · Artisan · Crafted
  ✓ Surface: Engraved (product ships with pre-engraved decorative
    designs — feature, not buyer-input)

GOOD vs BAD title examples:

❌ BAD (commas split phrases, generic, buyer-data promise):
   "Pretty Dress, Off Shoulder, for Women, Personalised With Name"

✅ GOOD (anchor "off shoulder prom dress" front-loaded in chars 0-40,
        " | " separators, occasion hook at the end, no buyer-data):
   "Off Shoulder Prom Dress | Pearl Sweetheart Neckline Formal Gown |
    Wedding Guest Style Bridesmaid Dress"

═══════════════════════════════════════════════════════════════
TAGS — EXACTLY 13, FACET-DISTRIBUTED, DEMAND-BALANCED
═══════════════════════════════════════════════════════════════

The single biggest ranking lever after the title. The seller is a
NEW shop competing with established ones, so the mix matters as
much as the words.

Hard rules:
  • EXACTLY 13 tags
  • Each ≤ 20 characters (compounds longer than 20 chars must be
    shortened, NOT truncated)
  • Lowercase, no punctuation
  • Prefer 2-3 words per tag. Single-word allowed ONLY when the word
    IS a recognised Etsy aesthetic/trend tag:
    "cottagecore", "y2k", "boho", "minimalist", "preppy", "grunge",
    "gothic", "kawaii"
  • No word repeats more than 2 times across all 13 tags

  UNIQUENESS IS MANDATORY — all 13 tags must be DISTINCT buyer angles.
  Do NOT submit a singular AND a plural of the same word ("prom dress"
  AND "prom dresses" = ONE wasted slot). Do NOT submit two phrasings of
  the same head noun ("mermaid prom dress" AND "mermaid prom gown"). The
  pipeline auto-collapses near-duplicates — if you send them you simply
  LOSE slots, so spend all 13 on genuinely different facets (material,
  color, silhouette, length, audience, occasion, style, aesthetic).
  Prefer MODERATE (1k-10k) and NICHE (<1k) long-tail tags a new shop can
  actually rank for; AVOID SATURATED (>=50k) single-word heads — they get
  auto-swapped downstream and waste a slot. A long-tail moderate tag
  converts; a saturated head does not.

Target demand mix (use the ✗/⚠/✓/★ tier flags from anchor block):
  • 0 SATURATED (✗). Never copy a ✗ anchor as a tag. Wasted slot.
    Examples seen in production that ruined listings: "leather bag"
    (599k), "crossbody bag" (309k), "gift for her" (9.5M), "evening
    dress" (130k), "beaded dress" (80k). DROP these.
  • 2-3 HOT (⚠, 10-50k). Pick the SHARPEST anchor for the product
    (e.g. "mermaid prom dress" not "prom dress").
  • 5-6 MODERATE (✓, 1k-10k). The sweet spot.
  • 3-4 NICHE (★, <1k). FREE WINS — easy page-1 ranking.
    Skipping niche entirely is the #1 mistake most generators make.

Facet diversity — cover at LEAST 5 of these 7 facets across the 13:
  1. Silhouette / product-form (mermaid, A-line, crossbody, slim fit,
     bodycon)
  2. Material / surface (leather, lace, satin, hammered, embroidered,
     velvet, 3d applique)
  3. Color (lilac, lavender, ivory, sage — Etsy SEO accepts color
     tags even though alt text can't have them; pick what's actually
     in the photo)
  4. Audience (bridesmaid, mother of bride, plus size, petite, nurse,
     working mom, teen)
  5. Occasion / use-case (prom, wedding, quinceanera, gala, work,
     daily commute, travel, concert)
  6. Construction / feature (strapless, off-shoulder, V-neck, halter,
     anti theft, rfid blocking, convertible)
  7. Length / size class (floor length, midi, mini, knee length,
     oversized, small, mini)

Order: lead the array with your strongest moderate/hot anchors in
slots 1-3 (Etsy weights early tags heavier). Niche tags toward the
end is fine.

Near-duplicate guard (HARD RULE):
  ❌ BAD — 4 mermaid variants eating slots:
     ["mermaid dress", "mermaid prom dress", "mermaid prom gown",
      "mermaid evening gown"]
     That's ONE keyword (mermaid + product) restated four ways. You
     get exactly one ranking surface, three slots wasted.
  ✅ GOOD — same product, 13 different angles across all 7 facets:
     - Anchor: "mermaid prom dress" (silhouette + occasion)
     - Material: "3d floral gown", "lace prom dress"
     - Color: "lilac prom dress", "lavender gown"
     - Audience: "quinceanera dress", "pageant gown", "engagement gown"
     - Construction: "strapless gown", "cape sleeve gown"
     - Niche: "flower applique dress", "embellished prom gown"

Visual accuracy — the image is your ground truth. NEVER tag a feature
that isn't visible in the photo:
  • Strapless ≠ off-shoulder. Strapless = no shoulder coverage at all.
    Off-shoulder = fabric band wrapping below the neck.
  • Sequins ≠ beading ≠ appliqué ≠ embroidery. Don't tag "sequin" if
    you see floral 3D appliqué.
  • Floor-length ≠ homecoming. Homecoming is SHORT (above knee). Long
    formal dresses are prom / evening / gala / wedding.
  • Wedding-guest = midi or cocktail. A floor-length gown is NOT
    wedding-guest wear; tagging it as such mislabels the listing.

GOOD vs BAD tag set example:

❌ BAD (duplicates wasting slots, buyer-data promises):
   ["dress", "dresses", "prom dress", "prom dresses",
    "personalised dress", "monogrammed dress", "customisable prom"]

✅ GOOD (mix of volumes across all facets, no dupes, no buyer-data):
   ["off shoulder dress", "prom dress", "sweetheart gown", "pearl bodice",
    "wedding guest dress", "satin prom gown", "formal evening dress",
    "bridesmaid dress", "elegant prom gown", "ball gown dress",
    "long formal dress", "gala dress", "homecoming dress"]

═══════════════════════════════════════════════════════════════
DESCRIPTION — 2 MARKETING PARAGRAPHS + "Features" LIST + "Perfect For" LIST
═══════════════════════════════════════════════════════════════

Write EVERY description in this EXACT structure — it is a proven,
high-converting Etsy layout: two flowing marketing paragraphs, then a
clean "Features" list, then a "Perfect For" list. Persuasive and human in
the paragraphs; short, scannable, keyword-rich in the lists.

──────────────────────────────────────────────
FORMATTING CONTRACT (non-negotiable)
──────────────────────────────────────────────
The description is ONE JSON string. Put the literal characters \\n between
every list line, and \\n\\n between the paragraphs and before/after each
section header. The two section headers are the literal words "Features"
and "Perfect For", each on its own line. Do NOT use any bullet character
(no •, no -, no *, no emoji) — just the header word, then each item on its
own line. Total length about 1200-2200 characters.

──────────────────────────────────────────────
PARAGRAPH 1 — HOOK + WHAT IT IS (2-3 sentences, flowing prose)
──────────────────────────────────────────────
Open with a confident, benefit-led marketing hook, name the product with
its strongest keyword early, say who it is for, and weave 2-3 standout
features into natural prose.
  GOOD: "Make a bold fashion statement with this sleek and stylish cropped
  leather jacket designed for modern women who love confident, trend-driven
  fashion. Featuring a flattering fitted silhouette, structured design, and
  front zipper closure, this jacket effortlessly combines contemporary
  streetwear style with timeless leather-inspired appeal."
Confident marketing openers are GOOD here ("Make a bold statement with…",
"Add a touch of elegance to…", "Bring effortless warmth to your home
with…", "Elevate your everyday with…"). A marketing hook about the product
is NOT fiction — only staged scenes are banned (see below).

──────────────────────────────────────────────
PARAGRAPH 2 — STYLING / USE + OCCASIONS (2-3 sentences, flowing prose)
──────────────────────────────────────────────
How the buyer wears, pairs, displays, or uses it, then a natural sweep of
occasions. This is the long-tail SEO surface AND the conversion close —
weave 3-5 anchor keywords (use cases, occasions, audiences) naturally.
  GOOD: "The cropped cut enhances your natural shape while creating a
  fashionable look that pairs perfectly with high-waisted jeans, skirts,
  trousers, and dresses. Whether you're heading out for a casual day, date
  night, concert, party, vacation, or city outing, this versatile jacket
  adds instant sophistication to your outfit."
For non-clothing items, swap styling for placement/use ("styles a console
table, shelf, or entryway with ease") plus the matching occasions and gift
recipients.

──────────────────────────────────────────────
"Features" LIST (8-12 short lines)
──────────────────────────────────────────────
A line that literally reads "Features", then 8-12 clean, scannable feature
phrases — one per line, ~3-7 words each, keyword-rich, NO bullet character,
and NO "so you can…" benefit clause (the paragraphs already sell; this list
is the scannable spec sweep). Match every feature to what you SEE in the
photo — never invent a material or detail.
  GOOD:
  Features
  Stylish cropped leather jacket design
  Front zipper closure
  Modern slim fit silhouette
  Classic turn down collar
  Long sleeves with zip cuffs
  Smooth premium leather look finish
  Lightweight and comfortable wear
  Fashionable Y2K inspired style
  Easy to pair with casual and dressy outfits
  Suitable for spring and autumn seasons

──────────────────────────────────────────────
"Perfect For" LIST (8-12 short lines)
──────────────────────────────────────────────
A line that literally reads "Perfect For", then 8-12 short use-case /
occasion / styling / recipient phrases — one per line, NO bullet character.
This is pure long-tail keyword surface: occasions, aesthetics, settings,
recipients.
  GOOD:
  Perfect For
  Everyday fashion
  Streetwear outfits
  Casual wear
  Date nights
  Concert outfits
  Party wear
  Vacation styling
  Fashion photoshoots
  Y2K inspired looks
  Trendy city outfits

If sizes or variants were supplied in the user prompt, mention them ONCE
naturally — in Paragraph 2 or as one "Features" line ("Available in XS-XXL
and 5 colors") — never in the title or tags.

EXAMPLE of a complete, correctly-formatted description (note the \\n
escapes, the two marketing paragraphs, then the two labelled lists):

"Make a bold fashion statement with this sleek and stylish cropped leather jacket designed for modern women who love confident, trend-driven fashion. Featuring a flattering fitted silhouette, structured design, and front zipper closure, this jacket effortlessly combines contemporary streetwear style with timeless leather-inspired appeal.\\n\\nThe cropped cut enhances your natural shape while creating a fashionable look that pairs perfectly with high-waisted jeans, skirts, trousers, and dresses. Whether you're heading out for a casual day, date night, concert, party, vacation, or city outing, this versatile jacket adds instant sophistication to your outfit.\\n\\nFeatures\\nStylish cropped leather jacket design\\nFront zipper closure\\nModern slim fit silhouette\\nClassic turn down collar\\nLong sleeves with zip cuffs\\nSmooth premium leather look finish\\nLightweight and comfortable wear\\nFashionable Y2K inspired style\\nEasy to pair with casual and dressy outfits\\nSuitable for spring and autumn seasons\\n\\nPerfect For\\nEveryday fashion\\nStreetwear outfits\\nCasual wear\\nDate nights\\nConcert outfits\\nParty wear\\nVacation styling\\nFashion photoshoots\\nY2K inspired looks\\nTrendy city outfits"

──────────────────────────────────────────────
BANNED in description (compliance — non-negotiable)
──────────────────────────────────────────────
Confident MARKETING copy is good; staged FICTION is banned. The test: copy
about the product and the buyer's real benefit/use/occasion is fine; a
narrated scene or stage-directed feeling is not.
  BANNED — staged-scene openings: "Picture him pulling these on…",
  "Imagine the moment when…", "On a quiet Sunday morning…", "She'll smile
  when she opens the box…", "Walk in and watch heads turn…".
  BANNED — stage-directed feeling: "you'll feel like a princess…",
  "you'll never take it off…". ("you" is fine for a REAL use: "pairs with
  your favorite heels", "keeps your hands free".)
  BANNED — empty hype / exclamation spam ("absolutely stunning!!!", "you
  NEED this", "must-have"). At most ONE "!" in the whole description.
  BANNED — shipping / processing / dispatch / delivery timing (Etsy shop
  settings own that).
  BANNED — buyer-data wording (personalised, customisable, monogram, "with
  name", "add your name/date"). Marketing/craft words (handmade, custom
  made, made to order, bespoke, engraved) ARE allowed.
  BANNED — fake scarcity / fake reviews ("only 2 left", "best-selling",
  "voted #1", "thousands of happy customers").
  BANNED — trademarked / IP terms and character-defining trait wording,
  EVEN when reframing (Rapunzel → no "long braid"/"golden braid"/"magic
  hair"; Frozen → no "ice queen"/"snow queen"; Cinderella → no "glass
  slipper"). Reframed copy reads as a generic item, not a thinly-veiled
  character.

Voice variation changes only the TONE and vocabulary of the two
paragraphs — NEVER the structure (2 paragraphs + "Features" list + "Perfect
For" list) and NEVER the no-fiction rule.

(Note for the JSON output: the description value is ONE string with literal
\\n between list lines and \\n\\n between paragraphs/sections — see the
OUTPUT block below.)

═══════════════════════════════════════════════════════════════
IMAGE ALT TEXT — exactly 1 general alt, ≤ 250 chars
═══════════════════════════════════════════════════════════════

Return EXACTLY ONE alt text string in the altTexts array (length 1).
The seller pastes the SAME string into every image slot on Etsy
(primary photo + every variant + every angle), so it MUST work
equally well for the blue version AND the white version AND the
black version AND every future variant.

NEVER include:
  ✗ Specific colour words: blue, white, black, red, pink, gold, rose
    gold, ivory, navy, sage, emerald, beige, lilac, lavender, olive,
    mauve, mint, cream, peach, coral, teal, burgundy, taupe
  ✗ Colour qualifiers: pastel, soft, deep, creamy, dusty, light,
    dark, bright, muted, rich, warm, cool
  ✗ Variant-specific pattern words: polka dot, floral print, striped,
    paisley, tartan, gingham, plaid (skip these even if visible —
    same alt has to fit the plain version)
  ✗ Per-image scene details: "model holding hem", "close-up of
    hem", "side view", "back view", "flat lay", "model wearing"

DO include (these stay constant across variants):
  ✓ Material: lace, satin, linen, cotton, leather, ceramic, wool
  ✓ Silhouette: fitted bodice, A-line, mermaid, oversized, slim fit
  ✓ Construction: strapless, sweetheart neckline, high slit, V-neck,
    crossbody, convertible strap, zip closure
  ✓ Length / size class: floor length, midi, knee length, ankle,
    small, mini, oversized
  ✓ Texture / surface: sheer mesh overlay, embroidered, pleated,
    embossed, distressed, hammered, ruched
  ✓ Function / use: evening, formal, prom, gala, wedding guest,
    work, travel, daily

Front-load the primary product noun (image SEO).

  ✓ "Lace evening gown strapless sweetheart bodice high slit floor
     length formal prom dress sheer mesh overlay floral appliqués"
  ✗ "Blue lace evening gown ..." — "blue" makes it wrong for every
     non-blue variant of this same listing
  ✗ "Model showing back of dress" — image-specific, won't fit the
     front-view or flat-lay photos

═══════════════════════════════════════════════════════════════
BANNED TRADEMARKED TERMS (VeRO violation = listing kill)
═══════════════════════════════════════════════════════════════

A VeRO (Verified Rights Owner) match removes the listing within
hours and damages the shop's standing. Never use:

Characters / franchises:
  Disney character names, Marvel, Pokemon, Harry Potter, Star Wars,
  Game of Thrones, Lord of the Rings, Hunger Games, Avengers,
  Frozen / Elsa / Anna, Rapunzel, Cinderella, Snow White, Little
  Mermaid / Ariel, Belle / Beauty and the Beast, Moana

Brands — apparel + sport:
  Nike, Adidas, Puma, Reebok, Under Armour, Lululemon, Supreme

Brands — luxury:
  LV, Louis Vuitton, Gucci, Hermes, Chanel, Prada, Dior, Versace,
  Burberry, YSL, Saint Laurent, Balenciaga, Fendi, Cartier,
  Tiffany & Co, Bulgari, Rolex

Leagues / teams:
  NFL, NBA, MLB, NHL, MLS, all team names + city + nickname combos
  (Lakers, Yankees, Cowboys, Patriots, etc.)

Celebrities + influencers:
  Real names of public figures (musicians, actors, athletes,
  influencers). "Inspired by Taylor Swift" still kills the listing.

═══════════════════════════════════════════════════════════════
VARIATIONS
═══════════════════════════════════════════════════════════════

If sizes and/or variants are supplied in the user prompt, mention
them ONCE in the description naturally:
  ✓ "Available in XS-XXL and 5 colors"
  ✓ "Available in 3 phone models and 4 designs"
  ✓ "Comes in gold, silver, and rose gold"

Do NOT put them in title or tags — Etsy handles variations as
separate variation fields on the listing form.

═══════════════════════════════════════════════════════════════
OUTPUT — strict JSON, NO prose, NO markdown fences
═══════════════════════════════════════════════════════════════

{
  "title": "string ≤140 chars, anchor in chars 0-40, ' | ' separators",
  "description": "Marketing paragraph 1 (hook + product + key features)\\n\\nMarketing paragraph 2 (styling + occasions, weave 3-5 anchors)\\n\\nFeatures\\nClean feature phrase\\n...(8-12 lines)\\n\\nPerfect For\\nUse case or occasion\\n...(8-12 lines)",
  "tags": ["...", ... exactly 13 items, each ≤20 chars],
  "altTexts": ["one general alt text ≤250 chars, no color words — array length 1"],
  "rationale": {
    "keywordFocus": "1 line — which anchor keyword(s) you anchored on and why",
    "titleStrategy": "1 line — what chars 0-40 do for ranking + how the rest of the title supports it",
    "audienceHook": "1 line — which buyer this targets + what triggers their click"
  }
}`;

// ─── Writing-voice variety ───────────────────────────────────────
//
// Same product + same Sonnet model = nearly identical output every
// time. Two employees generating the same listing got 80% overlap
// in title/description/tags. To break that uniformity, every
// generation picks a random voice from this list and tells Sonnet
// to write in the matching tone. Lives in the USER prompt (not the
// system prompt) so it doesn't invalidate the system-prompt cache.
//
// IMPORTANT (May 19 2026): every voice must produce a benefit-led
// opening, NOT a narrative scene. Previous "warm-storyteller",
// "lifestyle-aspirational", and "playful-casual" voices were
// generating openings like "Picture him pulling these on for the
// first shift…" — bad Etsy copy that CEO flagged. Removed. The
// DESCRIPTION rule in the system prompt also explicitly bans
// narrative openings as belt-and-suspenders.
//
// Each voice is a STYLISTIC variation (vocabulary + sentence
// rhythm), not a genre swap. Voice changes the texture of the
// language, never the structure (state-what-it-is → benefits →
// bullets → care).

const GENERATOR_VOICES: { name: string; instruction: string }[] = [
  {
    name: "fashion-editorial",
    instruction:
      "FASHION-EDITORIAL. Write the two paragraphs in the polished vocabulary of a fashion magazine — silhouette, drape, statement, finish, palette — confident and aspirational without hype. Keep the exact structure: 2 marketing paragraphs, then a \"Features\" list, then a \"Perfect For\" list. No fiction/staged scenes.",
  },
  {
    name: "warm-lifestyle",
    instruction:
      "WARM LIFESTYLE. Write the two paragraphs warm, inviting, and everyday-relatable — how it fits real life and real moments — without staging a scene. Keep the exact structure: 2 marketing paragraphs, then a \"Features\" list, then a \"Perfect For\" list. No fiction.",
  },
  {
    name: "confident-bold",
    instruction:
      "CONFIDENT & BOLD. Write the two paragraphs punchy and assured — \"make a statement\" energy, short strong sentences. Persuade with specifics, not exclamation marks. Keep the exact structure: 2 marketing paragraphs, then a \"Features\" list, then a \"Perfect For\" list. No fiction.",
  },
  {
    name: "premium-elegant",
    instruction:
      "PREMIUM & ELEGANT. Write the two paragraphs refined and understated — quiet-luxury tone, every word earns its place. Keep the exact structure: 2 marketing paragraphs, then a \"Features\" list, then a \"Perfect For\" list. No fiction, no hype.",
  },
  {
    name: "friendly-stylist",
    instruction:
      "FRIENDLY STYLIST. Write the two paragraphs like a sharp stylist friend recommending it — approachable, specific styling advice in paragraph 2. \"You\" is allowed only for real uses (\"pairs with your favorite jeans\"), never staged feeling. Keep the exact structure: 2 marketing paragraphs, then a \"Features\" list, then a \"Perfect For\" list.",
  },
  {
    name: "trend-forward",
    instruction:
      "TREND-FORWARD. Write the two paragraphs current and aesthetic-driven — name the look/trend it fits (Y2K, cottagecore, clean-girl, coastal, etc.) where it genuinely matches the product. Keep the exact structure: 2 marketing paragraphs, then a \"Features\" list, then a \"Perfect For\" list. No fiction.",
  },
  {
    name: "practical-clear",
    instruction:
      "PRACTICAL & CLEAR. Write the two paragraphs straightforward and benefit-focused — what it is, why it's good, how it's used — zero fluff, zero hype. Keep the exact structure: 2 marketing paragraphs, then a \"Features\" list, then a \"Perfect For\" list. No fiction.",
  },
  {
    name: "gift-focused",
    instruction:
      "GIFT-FOCUSED. Write the two paragraphs around who it's a great gift for and the occasions it suits — concrete recipients and moments woven into the prose, never a \"she'll smile when she opens it\" scene. Keep the exact structure: 2 marketing paragraphs, then a \"Features\" list, then a \"Perfect For\" list. No fiction.",
  },
];

function pickGeneratorVoice(): { name: string; instruction: string } {
  return GENERATOR_VOICES[
    Math.floor(Math.random() * GENERATOR_VOICES.length)
  ];
}

function buildGeneratorUserPrompt(input: GenerationInput): string {
  // Top 10 competitors, titles only. We used to send 20 + each one's full
  // tag array — but the ANCHOR KEYWORDS block already distils both into
  // top-frequency phrases + tags, so the per-competitor tag dump was just
  // noise (and ~750 input tokens). Titles still earn their slot — Sonnet
  // reads them for positioning + hook patterns, which frequency analysis
  // can't capture.
  const competitorBlock = input.competitors
    .slice(0, 10)
    .map((c) => `#${c.rank} (${c.favorites} favs) — ${c.title}`)
    .join("\n");

  // Anchor keyword block — distilled from the competitors above. These
  // are the high-frequency phrases Sonnet MUST front-load.
  //
  // DEMAND-ANNOTATED (May 20 2026): when the route pre-checked each
  // anchor against live Etsy demand, the entries carry a `demand` field
  // with tier + total listings. We render that as ✗/⚠/✓/★ flags so
  // Sonnet can SEE which anchor terms are saturated and avoid copying
  // them into the tag list. Without this signal Sonnet was producing
  // 12/13 saturated tags for mature categories (leather bag = 599k,
  // crossbody bag = 309k, gift for her = 9.5M) because its training
  // data heuristic for "common product tag" mismatches Etsy's actual
  // demand density. CEO directive May 20: best keywords + top-tier SEO,
  // no more saturated suggestions in the output.
  const tierFlag = (tier?: string): string => {
    switch (tier) {
      case "saturated":
        return "✗ SATURATED — DO NOT USE AS A TAG";
      case "hot":
        return "⚠ HOT — use sparingly (max 2-3 across the 13 tags)";
      case "moderate":
        return "✓ MODERATE — primary target";
      case "niche":
        return "★ NICHE — easy win, prioritise";
      default:
        return "(demand not measured)";
    }
  };
  const fmtListings = (n?: number) =>
    n === undefined ? "" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : `${n}`;

  const phrasesBlock = input.anchorKeywords.topPhrases
    .map((p) => {
      const tierStr = p.demand ? ` — ${tierFlag(p.demand.tier)}` : "";
      const demandStr = p.demand
        ? ` [${fmtListings(p.demand.totalListings)} Etsy listings]`
        : "";
      return `   • "${p.phrase}" (${p.count}/${input.anchorKeywords.totalListings} comps, ${p.percentage}%)${demandStr}${tierStr}`;
    })
    .join("\n");
  const tagsBlock = input.anchorKeywords.topTags
    .map((t) => {
      const tierStr = t.demand ? ` — ${tierFlag(t.demand.tier)}` : "";
      const demandStr = t.demand
        ? ` [${fmtListings(t.demand.totalListings)} Etsy listings]`
        : "";
      return `   • ${t.phrase} (${t.count}/${input.anchorKeywords.totalListings} comps)${demandStr}${tierStr}`;
    })
    .join("\n");
  const hasDemandData =
    input.anchorKeywords.topPhrases.some((p) => p.demand) ||
    input.anchorKeywords.topTags.some((t) => t.demand);
  const anchorBlock =
    input.anchorKeywords.topPhrases.length > 0 ||
    input.anchorKeywords.topTags.length > 0
      ? `# ANCHOR KEYWORDS — proven buyer-search terms from the top ${input.anchorKeywords.totalListings} listings${hasDemandData ? " (with live Etsy demand)" : ""}

These phrases / tags appear repeatedly in winning listings for this keyword space. Front-load them in your title (especially the first 40 chars) and lead with them in your tag set.

${hasDemandData ? `**CRITICAL — read the tier flags carefully:**
- ✗ SATURATED entries: NEVER use as standalone tags. They may appear in the title only if they describe what the product literally IS, but as a tag they're wasted slots (>50k competing listings).
- ⚠ HOT entries: at most 2-3 across your 13 tags.
- ✓ MODERATE + ★ NICHE: front-load these. They're the easy-win ranking slots.

If most anchors are saturated, generate your own NICHE/MODERATE variants by adding qualifiers (material, style, audience, occasion, color, size) — e.g. saturated "leather bag" → niche "vegan leather laptop bag" / "small leather crossbody work bag" / "leather diaper changing bag".

` : ""}Top phrases (titles):
${phrasesBlock || "   (no high-frequency phrases found)"}

Top tags (seller-curated):
${tagsBlock || "   (no high-frequency tags found)"}
`
      : "";

  // Buyer-language brainstorm — long-tail variants Haiku generated by
  // reasoning about how real buyers phrase searches. Unscored (we
  // removed the per-phrase Etsy demand scoring to save 25 calls/gen);
  // Sonnet uses these as alternative-angle inspiration. The anchor
  // keywords block above is still the primary signal since those
  // phrases are PROVEN to rank.
  const buyerVariantsBlock =
    input.buyerVariants.length > 0
      ? `# ALTERNATIVE BUYER-SEARCH ANGLES (brainstorm)

Long-tail phrases a real buyer might type, generated from how the
product looks + the seed keyword. These are unproven — use them as
inspiration for tag variety + audience hooks, but PRIORITISE the
anchor keywords above when there's a conflict (those are observed to
rank, these are inferred).

${input.buyerVariants
  .slice(0, 20)
  .map((v) => `   • ${v}`)
  .join("\n")}
`
      : "";

  const variationsBlock: string[] = [];
  if (input.sizes && input.sizes.length > 0) {
    variationsBlock.push(`Available sizes: ${input.sizes.join(", ")}`);
  }
  if (input.variants && input.variants.length > 0) {
    // "Variants" is a generic axis — could be colors, phone models,
    // designs, materials, etc. Sonnet weaves them into the description
    // naturally ("Available in 3 designs", "Comes in 5 colors").
    variationsBlock.push(`Available variants: ${input.variants.join(", ")}`);
  }

  // Pick a random writing voice for this generation. See
  // GENERATOR_VOICES above — this is what breaks the "every listing
  // sounds the same" problem.
  const voice = pickGeneratorVoice();

  // Reframe constraint block — only present when the rule engine OR
  // vision flagged the product. Threaded into the user prompt (not
  // system) so the system-prompt cache stays warm. These are HARD
  // constraints: Sonnet must follow them in addition to every system-
  // prompt rule.
  const reframeBlock = input.reframeConstraints
    ? `# ⚠ POLICY-SAFE REFRAME REQUIRED — read carefully

The source product was flagged by Etsy's policy rules (IP, brand,
commodity tells, or personalisation wording). Generate a listing that
PASSES Etsy's automated keyword scans by following these hard
constraints:

LISTING APPROACH (frame the listing this way):
${input.reframeConstraints.listingApproach}

TITLE RULES:
${input.reframeConstraints.titleGuidance.map((b) => `  • ${b}`).join("\n")}

TAG RULES:
${input.reframeConstraints.tagGuidance.map((b) => `  • ${b}`).join("\n")}

DESCRIPTION RULES:
${input.reframeConstraints.descriptionGuidance.map((b) => `  • ${b}`).join("\n")}

NEVER include these exact words/phrases ANYWHERE (title, tags,
description, alt text, rationale):
${input.reframeConstraints.avoidWords.map((w) => `  ✗ ${w}`).join("\n")}

If you put any of the AVOID words in the output, the listing will be
removed by Etsy within hours. They are non-negotiable. Replace each
flagged concept with the descriptive equivalents from the LISTING
APPROACH above.

`
    : "";

  return `# Writing voice for THIS listing — ${voice.name}
${voice.instruction}

(This voice is randomly assigned per generation so the shop's listings sound varied instead of all using the same template phrasing. Still follow every CORE RULE in the system prompt — voice changes tone, not structure or output format.)

${reframeBlock}# Source title
${input.productBrief}

# Target Etsy category
${input.category.path}  (taxonomy_id: ${input.category.id})

# Audience / style hints
${input.audience ? `Audience: ${input.audience}` : "Audience: (infer from images + title)"}
${input.style ? `Style: ${input.style}` : "Style: (infer from images)"}

${variationsBlock.length > 0 ? `# Variations & options\n${variationsBlock.join("\n")}\n\n` : ""}${anchorBlock}${buyerVariantsBlock}# Live Etsy top-10 ranking titles for this keyword space

Reference only — DON'T copy phrasing. Identify positioning + hook patterns and write something ORIGINAL that targets the same buyer better.

${competitorBlock || "(no competitor data — generate based on the brief alone)"}

# Output count expected
- altTexts: EXACTLY 1 item (one general listing-level alt text the seller pastes onto every image — see IMAGE ALT TEXT rule in the system prompt)

Now produce the listing JSON in the assigned voice.`;
}

export async function generateListing(
  input: GenerationInput,
  accum?: CostAccumulator,
): Promise<GeneratedListing> {
  const userContent: ContentBlock[] = [];

  if (input.images.length > 0) {
    userContent.push(...toImageBlocks(input.images));
  }

  userContent.push({
    type: "text",
    text: buildGeneratorUserPrompt(input),
  });

  const msg = await client().messages.create({
    model: MODEL_GENERATOR,
    max_tokens: 3000,
    // Bumped 0.65 -> 0.85 so two employees generating the same
    // product get more varied output. Combined with the per-gen
    // voice picker (see GENERATOR_VOICES), this addresses the
    // "two employees got 80% identical listings" complaint.
    temperature: 0.85,
    // Same caching strategy as the compliance call — the generator
    // system prompt is large + static (~3k tokens). Cache hit cuts
    // input cost to ~10%.
    system: [
      {
        type: "text",
        text: GENERATOR_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: userContent },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_GENERATOR));

  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<GeneratedListing>(raw);
  return normalize(parsed, input.images.length);
}

// ─── Targeted regeneration (QC layer) ──────────────────────────────
//
// Both reuse the cached GENERATOR_SYSTEM (warm prompt cache) + the
// assistant-prefill "{" JSON contract. The route's Stage 4.6 QC gate
// calls these to fix a weak description or a short tag set WITHOUT a
// full re-generation — and WITHOUT re-sending images (vision compliance
// already ran on the first pass). The description rewrite NEVER touches
// the title or tags, so tag uniqueness can never be undone by a retry.

export async function regenerateDescription(
  opts: {
    categoryPath: string;
    approvedTitle: string;
    approvedTags: string[];
    avoidWords?: string[];
    failingItems: string[];
  },
  accum?: CostAccumulator,
): Promise<string> {
  const avoidBlock =
    opts.avoidWords && opts.avoidWords.length > 0
      ? `\n# Reframe constraint — NEVER use any of these words anywhere: ${opts.avoidWords.join(", ")}.`
      : "";
  const failBlock =
    opts.failingItems.length > 0
      ? opts.failingItems.map((i) => `- ${i}`).join("\n")
      : "- Read like a dry spec sheet — no benefit-led hook and no conversion element (gifting / styling / persuasion / buyer-identity).";

  const user = `# REWRITE THE DESCRIPTION ONLY
The title and tags below are FINAL and correct — do NOT change them, do NOT output them. Return ONLY: {"description": "..."}.

# Approved title (context only)
${opts.approvedTitle}

# Approved tags (context only — weave 3-5 naturally into the WHO IT'S FOR section, do NOT list them)
${opts.approvedTags.join(", ")}

# Category
${opts.categoryPath}${avoidBlock}

# What was WRONG with the previous description — fix EVERY item:
${failBlock}

# HARD RULES (restated because they were the failure):
- Follow the DESCRIPTION section of the system prompt EXACTLY: two flowing marketing paragraphs, then a "Features" list (8-12 short lines, NO bullet character), then a "Perfect For" list (8-12 short lines, NO bullet character). ~1200-2200 chars. Use the literal two-character newline escape between list lines and a blank-line escape between paragraphs/sections, inside the JSON string value.
- The HOOK must lead with the strongest keyword + a compelling buyer benefit in the first 1-2 lines.
- Persuasive, human, benefit-led copy is REQUIRED and GOOD. Corny short-story / scene-direction openings are BANNED — no "Picture…", "Imagine…", "On a quiet…", "She'll smile when…", no "you'll feel…/you'll reach for…". "You" is allowed ONLY to state a real, checkable benefit. Persuade WITHOUT fiction.
- Paragraph 1 = a confident keyword-led marketing hook + what it is + 2-3 key features in prose. Paragraph 2 = styling/use + an occasions sweep, weaving 3-5 approved tags as use cases. The "Perfect For" list carries the occasions/recipients. Confident marketing openers ("Make a bold statement with…") are GOOD; only staged fiction is banned.
- NO shipping / processing / dispatch / delivery timing anywhere.
- NO empty hype, fake scarcity, or fake reviews; at most one "!" in the whole description.
- NO buyer-data wording (personalised, customisable, monogram, "with name"); marketing/craft words (handmade, custom made, made to order, bespoke, engraved) ARE allowed.
- NO trademarked / IP terms and NO character-defining trait wording.
Output strict JSON, no prose, no markdown fences: {"description":"..."}`;

  const msg = await client().messages.create({
    model: MODEL_GENERATOR,
    max_tokens: 1200,
    temperature: 0.7,
    system: [
      {
        type: "text",
        text: GENERATOR_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: user },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_GENERATOR));
  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<{ description?: string }>(raw);
  return normalizeDescription(parsed.description ?? "").slice(
    0,
    ETSY_LIMITS.DESCRIPTION_MAX,
  );
}

export async function regenerateTags(
  opts: { categoryPath: string; approvedTitle: string },
  accum?: CostAccumulator,
): Promise<string[]> {
  const user = `# REGENERATE TAGS ONLY — return {"tags": ["..."]}
Title (final): ${opts.approvedTitle}
Category: ${opts.categoryPath}
The previous tag set fell short of 13 UNIQUE tags after near-duplicate folding (singular/plural pairs and shared-core-noun variants were collapsed).
Output 16 tags (over-supply so the de-dup engine lands exactly 13): each <=20 chars, lowercase, no punctuation, NO personalised / monogram / "with name" wording.
Each tag must be a DISTINCT buyer angle — vary the FACET (material, color, silhouette, audience, occasion, length, style, aesthetic). Do NOT submit singular+plural pairs or two phrasings of the same head noun (not both "prom dress" and "prom gown"). Prefer MODERATE / NICHE long-tail over saturated short heads.
Strict JSON only: {"tags":[ ... 16 items ... ]}`;

  const msg = await client().messages.create({
    model: MODEL_GENERATOR,
    max_tokens: 400,
    temperature: 0.6,
    system: [
      {
        type: "text",
        text: GENERATOR_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: user },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_GENERATOR));
  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<{ tags?: string[] }>(raw);
  return Array.isArray(parsed.tags) ? parsed.tags : [];
}

// ─── Stage 3 — Text compliance audit (Haiku) ────────────────────────

export interface TextComplianceReport {
  ok: boolean;
  issues: { severity: "warn" | "block"; field: string; message: string }[];
}

const VALIDATOR_SYSTEM = `You are an Etsy compliance auditor. Given a listing draft (TEXT ONLY — no images at this stage), check for:

1. TRADEMARK / IP in the text — flag specific brand names (Disney, Marvel, Nike, NFL/NBA/MLB team names, copyrighted characters, Pokemon, etc.). Generic words like "vintage" or "minimalist" are fine.
2. PROHIBITED TEXT — weapons, drugs, regulated wellness claims, adult content where category doesn't allow it.
3. RULES — title >140 chars, tag >20 chars, tag count != 13, duplicate tags, description >5000 chars.
4. REDUNDANCY — tag duplicates / near-duplicates (singular+plural pairs are wasted slots).

OUTPUT — strict JSON only:
{
  "ok": boolean,
  "issues": [
    {"severity": "warn"|"block", "field": "title"|"tags"|"description"|"attributes", "message": "..."}
  ]
}

Mark severity "block" only for things that would get the listing taken down or auto-rejected. Mark "warn" for redundancy / suboptimal but legal.`;

export async function validateListing(
  listing: GeneratedListing,
): Promise<TextComplianceReport> {
  const msg = await client().messages.create({
    model: MODEL_VALIDATOR,
    max_tokens: 800,
    temperature: 0,
    system: VALIDATOR_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Audit this listing:\n\n${JSON.stringify(
          {
            title: listing.title,
            tags: listing.tags,
            description: listing.description,
          },
          null,
          2,
        )}`,
      },
      { role: "assistant", content: "{" },
    ],
  });

  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<TextComplianceReport>(raw);
  const localIssues = localRuleCheck(listing);
  return {
    ok: parsed.ok && localIssues.every((i) => i.severity !== "block"),
    issues: [...(parsed.issues ?? []), ...localIssues],
  };
}

// ─── Description QC scorer (Haiku) — wires the previously-dead ────────
//     VALIDATOR_SYSTEM intent into a LIVE conversion-quality gate.
//
// Cheap (~$0.0007/call, Haiku, temp 0). Persuasive / human / benefit-led
// copy scores HIGH; corny fiction or scene-direction openings are a HARD
// FAIL regardless of other quality. The route's Stage 4.6 QC gate calls
// this and regenerates the description (only) when it fails.
export interface DescriptionScore {
  overallScore: number;
  hasNarrativeOpening: boolean;
  hasSceneDirection: boolean;
  hasShippingLanguage: boolean;
  hasMtoWording: boolean;
  hasBannedTrademark: boolean;
  missingHook: boolean;
  missingWhoItsFor: boolean;
  notBenefitLed: boolean;
  bulletCount: number;
  failingItems: string[];
}

const DESCRIPTION_SCORER_SYSTEM = `You are an Etsy listing-description QC scorer — NOT a rewriter. The TARGET FORMAT is: TWO flowing marketing paragraphs, then a "Features" list, then a "Perfect For" list. Confident MARKETING copy in the paragraphs is GOOD; corny FICTION / staged scenes are BAD — they are NOT the same thing.

Return strict JSON only:
{
  "overallScore": 0-100,
  "hasNarrativeOpening": boolean,   // staged scene: "Picture him…","Imagine…","On a quiet Sunday…","She'll smile when…" = true. A marketing hook like "Make a bold statement with…" is NOT this.
  "hasSceneDirection": boolean,     // "you'll feel…","you'll reach for…", stage-directed emotion = true
  "hasShippingLanguage": boolean,   // ships in X days / dispatch / processing time / business days = true
  "hasMtoWording": boolean,         // personalised / customisable / monogram / "with name" = true
  "hasBannedTrademark": boolean,    // Disney / Marvel / Nike / NFL etc. or copyrighted character names = true
  "missingHook": boolean,           // paragraph 1 does NOT open with a confident, keyword-led product hook
  "missingWhoItsFor": boolean,      // NO "Perfect For" list AND no occasions/use-cases anywhere = true
  "notBenefitLed": boolean,         // the two PARAGRAPHS are dry/spec-only with no persuasion or styling = true (the plain Features list is EXPECTED — never set this just because the Features list is plain)
  "bulletCount": integer,           // number of list lines (Features + Perfect For combined)
  "failingItems": ["short human-readable reason per failure"]
}

SCORING:
- >=70 ships. A confident marketing hook ("Make a bold fashion statement with this cropped leather jacket…") + a styling/occasions paragraph + a "Features" list + a "Perfect For" list scores HIGH.
- STRUCTURE matters: a strong description has 2 marketing paragraphs AND a "Features" list AND a "Perfect For" list. If the "Features" list OR the "Perfect For" list is missing, or there is only one short paragraph, score it <70.
- Confident MARKETING openers are GOOD and must NOT be flagged as fiction. A real fiction / staged-scene opening IS a hard fail: set hasNarrativeOpening (or hasSceneDirection) true AND overallScore <70.
- "you" used for a REAL use ("pairs with your favorite jeans") is FINE — only stage-directed emotion ("you'll feel like a princess") is hasSceneDirection.
- The "Features" list SHOULD be plain feature phrases (no "so you can…" clauses) — do NOT penalize that; the paragraphs do the selling.
- List a verbatim, specific reason in failingItems for every boolean you set true and whenever overallScore <70, so the rewriter knows exactly what to fix.`;

export async function scoreDescription(
  description: string,
  accum?: CostAccumulator,
): Promise<DescriptionScore> {
  const msg = await client().messages.create({
    model: MODEL_VALIDATOR,
    max_tokens: 500,
    temperature: 0,
    system: DESCRIPTION_SCORER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Description to score:\n\n<<<\n${description}\n>>>`,
      },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_VALIDATOR));
  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<Partial<DescriptionScore>>(raw);
  // Defensive coercion — a missing/garbled field must never crash the gate.
  return {
    overallScore:
      typeof parsed.overallScore === "number" ? parsed.overallScore : 0,
    hasNarrativeOpening: !!parsed.hasNarrativeOpening,
    hasSceneDirection: !!parsed.hasSceneDirection,
    hasShippingLanguage: !!parsed.hasShippingLanguage,
    hasMtoWording: !!parsed.hasMtoWording,
    hasBannedTrademark: !!parsed.hasBannedTrademark,
    missingHook: !!parsed.missingHook,
    missingWhoItsFor: !!parsed.missingWhoItsFor,
    notBenefitLed: !!parsed.notBenefitLed,
    bulletCount:
      typeof parsed.bulletCount === "number" ? parsed.bulletCount : 0,
    failingItems: Array.isArray(parsed.failingItems)
      ? parsed.failingItems.map((x) => String(x))
      : [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractText(msg: Anthropic.Message): string {
  return msg.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

function safeParseJson<T>(raw: string): T {
  const trimmed = raw.trim();
  const lastBrace = trimmed.lastIndexOf("}");
  const candidate = lastBrace >= 0 ? trimmed.slice(0, lastBrace + 1) : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    throw new Error(
      `Claude returned non-JSON output. First 200 chars: ${trimmed.slice(0, 200)}`,
    );
  }
}

// Phrases that imply BUYER-SUPPLIED PERSONAL DATA on the product
// (the buyer types their name, date, message, etc. and we put it
// on the item). META7MEDIA ships ready-stock — there's no input
// field for this, so promising it would mislead the buyer.
//
// IMPORTANT (May 16 2026 final CEO policy after two corrections):
// The KEY question is "does the buyer supply their own text/name?"
//
//   ✅ ALLOWED (marketing / feature wording, NOT buyer-data promises):
//      handmade, hand-knit, hand-stitched, hand-crafted, hand-sewn,
//      custom made, custom order, custom sized, custom fit,
//      made to order, MTO, bespoke, engraved, artisan
//
//   ❌ BANNED (buyer-data-on-product promises):
//      personalised / personalized / personalisation
//      customisable / customizable / customization
//      monogram / monogrammed (= buyer's initials)
//      "with name" / "with your name" / "printed with name"
//      "your name on" / "name on" (as in "your name on it")
const MTO_PATTERNS = [
  /\b(personali[sz]ed?|personali[sz]ation)\b/gi,
  /\b(customi[sz]able|customi[sz]ation)\b/gi,
  /\b(monogram|monogrammed|monograms)\b/gi,
  /\bwith[\s-]your[\s-]name\b/gi,
  /\bwith[\s-]name\b/gi,
  /\bprinted[\s-]with[\s-]name\b/gi,
  /\byour[\s-]name[\s-]on\b/gi,
];

function stripMtoFromTitle(title: string): string {
  let cleaned = title;
  for (const re of MTO_PATTERNS) cleaned = cleaned.replace(re, "");
  // Collapse separator+whitespace artefacts left behind (e.g. "| | ")
  cleaned = cleaned
    .replace(/\s*\|\s*\|+\s*/g, " | ")
    .replace(/^\s*\|\s*/g, "")
    .replace(/\s*\|\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned;
}

function tagLooksLikeMto(tag: string): boolean {
  return MTO_PATTERNS.some((re) => {
    re.lastIndex = 0; // reset stateful flag /g
    return re.test(tag);
  });
}

// ════════════════════════════════════════════════════════════════════
// DETERMINISTIC TAG-UNIQUENESS ENGINE  (merged winner)
// File: src/lib/services/anthropic.service.ts
// Insert this block immediately AFTER tagLooksLikeMto() (ends line 2297)
// and BEFORE normalizeDescription() (line 2299), so ETSY_LIMITS (line 129)
// + MTO_PATTERNS (2269) + tagLooksLikeMto (2292) are already in scope.
//
// GUARANTEE: returns EXACTLY ETSY_LIMITS.TAG_COUNT (13) tags whenever the
// combined (primary ∪ reserve) pool yields >=13 canonically-distinct,
// admissible tags. Pure + synchronous + deterministic (same input ⇒ same
// 13 tags). Documents the one genuinely-impossible case via `short:true`.
// ════════════════════════════════════════════════════════════════════

const TAG_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in",
  "on", "to", "by", "from", "at",
]);

/**
 * Plural-aware canonical stem of ONE word. (Grafted from Draft 2 — the
 * empirically-most-robust of the three stemmers: it is the only one that
 * collapses shoe/shoes AND avoids the status→statu / scarves→scarfe
 * over-collapse bugs the other drafts had.)
 *   dresses→dress, gowns→gown, boxes→box, parties→party, leaves→leaf,
 *   shoes→shoe. Protects -ss (dress stays dress) and short words (<=3).
 * NOTE: linguistic perfection is NOT required — dedup only needs the
 * singular and plural of the SAME word to map to the SAME stem, which
 * this guarantees for every realistic Etsy tag noun.
 */
function stemWord(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;                 // ring, bag, tee, ear
  if (w.endsWith("ss")) return w;              // dress, glass — not a plural
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y"; // parties→party
  if (w.endsWith("ves") && w.length > 4) return w.slice(0, -3) + "f"; // scarves→scarf, leaves→leaf
  if (w.endsWith("es") && w.length > 4) {
    if (/(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2); // boxes→box, dresses→dress, dishes→dish
    return w.slice(0, -1);                                 // shoes→shoe
  }
  if (w.endsWith("s") && !w.endsWith("us") && !w.endsWith("ss")) {
    return w.slice(0, -1);                     // gowns→gown, bags→bag (status/glass protected above)
  }
  return w;
}

/** Significant, plural-normalised stems of a tag (drops stop words + <4-char noise). */
function tagStems(tag: string): string[] {
  return tag
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !TAG_STOP_WORDS.has(w))
    .map(stemWord);
}

/**
 * Canonical signature for EXACT + NEAR dup folding: the sorted SET of
 * plural-normalised stems, joined. Order-independent + plural-aware:
 *   "prom dress" / "prom dresses" / "dresses prom"  → "dress prom"
 * Falls back to the cleaned raw string for tags with no significant
 * stems (e.g. single aesthetic word "y2k") so they don't all collapse
 * to canonical "".
 */
function tagCanonical(tag: string): string {
  const stems = tagStems(tag);
  if (stems.length === 0) return tag.toLowerCase().trim();
  return [...new Set(stems)].sort().join(" ");
}

/** Etsy-clean one raw candidate; returns null if it must be dropped. */
function cleanTag(raw: unknown): string | null {
  const t = (raw ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // Etsy: letters, digits, spaces, hyphens only
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ETSY_LIMITS.TAG_MAX_CHARS)
    .trim();                         // re-trim in case slice left a trailing space
  if (t.length < 3) return null;
  if (tagLooksLikeMto(t)) return null; // existing single-source-of-truth MTO guard
  return t;
}

export interface TagUniquenessResult {
  tags: string[];           // EXACTLY 13 unless short === true
  exactDropped: string[];   // dropped as exact/canonical duplicates (or 13-overflow)
  nearDropped: string[];    // dropped by the shared-core-noun cap (pre-relaxation)
  short: boolean;           // true ONLY when <13 canonically-distinct tags exist
}

/**
 * THE ENGINE. Deterministic, order-preserving (earliest = highest model
 * confidence wins). Four graceful tiers so we ALWAYS reach 13 if the pool
 * allows:
 *   PASS 1  Clean + MTO-strip + canonical de-dup (plural pairs + word-order
 *           rephrases collapse). First occurrence kept.
 *   PASS 2  Shared-core-noun cap (MAX_PER_STEM=3, the CEO's May-20
 *           calibration). Cap-blocked tags are DEFERRED, not discarded.
 *   PASS 3  Reserve refill — canonical-unique AND cap-aware — pulls clean
 *           non-colliding tags from the reserve pool to fill cap-freed slots.
 *   PASS 4  Graceful relaxation. If still <13: (4a) re-admit cap-deferred
 *           tags (still canonical-UNIQUE, just core-noun-heavy — honours the
 *           "13 filled slots beat 8 with 5 empty" CEO rule), then (4b)
 *           canonical-unique reserve ignoring the cap.
 *
 * DEFENSIVE SUBSTRING NEAR-DUP GUARD (grafted, hardened from Draft 2):
 *   On PASSES 1-3 we additionally reject a candidate whose cleaned string
 *   is a whole-token superset/subset of an already-accepted tag sharing the
 *   SAME core noun (e.g. "mermaid dress" vs "long mermaid dress"). This is
 *   scoped to same-core-noun pairs so it can NEVER over-reject legit tags
 *   like "ring" vs "gold ring stacking set" that share a stem but express
 *   distinct buyer angles — the cap (PASS 2) already governs those.
 *
 * CONTRACT / IMPOSSIBLE CASE: returns exactly 13 whenever (primary ∪
 * reserve) has >=13 canonically-distinct admissible tags. `short:true`
 * fires ONLY when the entire input genuinely contains fewer than 13
 * distinct tags — a generation-quality problem, never an engine bug. We
 * NEVER pad with duplicates, empties, or garbage. The caller's QC layer
 * treats short:true as a tags-regeneration trigger (see validationChecks).
 */
export function enforceTagUniqueness(
  primary: unknown[],
  reserve: unknown[] = [],
  opts: { maxPerStem?: number } = {},
): TagUniquenessResult {
  const MAX_PER_STEM = opts.maxPerStem ?? 3;
  const CAP = ETSY_LIMITS.TAG_COUNT; // 13

  const exactDropped: string[] = [];
  const nearDropped: string[] = [];

  // ── PASS 1 — clean + canonical de-dup (plural-aware) ──
  type Cand = { tag: string; stems: string[]; canon: string; core: string };
  const canonSeen = new Set<string>();
  const uniques: Cand[] = [];
  for (const raw of primary) {
    const tag = cleanTag(raw);
    if (!tag) continue;
    const canon = tagCanonical(tag);
    if (canonSeen.has(canon)) {
      exactDropped.push(tag);
      continue;
    }
    canonSeen.add(canon);
    const stems = tagStems(tag);
    uniques.push({
      tag,
      stems,
      canon,
      core: stems.length > 0 ? stems[stems.length - 1] : tag,
    });
  }

  const accepted: Cand[] = [];
  const stemCount = new Map<string, number>();
  const capDeferred: Cand[] = [];

  // Same-core substring near-dup guard (scoped — never over-rejects
  // cross-concept tags that merely share a stem).
  const isSubstringNearDup = (c: Cand): boolean =>
    accepted.some(
      (p) =>
        p.core === c.core &&
        (p.tag.includes(c.tag) || c.tag.includes(p.tag)),
    );

  // ── PASS 2 — core-noun cap (defer, don't discard) ──
  for (const c of uniques) {
    if (accepted.length >= CAP) {
      exactDropped.push(c.tag); // model over-supplied past 13
      continue;
    }
    if (isSubstringNearDup(c)) {
      nearDropped.push(c.tag);
      continue;
    }
    const exceeds = c.stems.some((s) => (stemCount.get(s) ?? 0) >= MAX_PER_STEM);
    if (exceeds) {
      capDeferred.push(c);
      nearDropped.push(c.tag);
      continue;
    }
    for (const s of c.stems) stemCount.set(s, (stemCount.get(s) ?? 0) + 1);
    accepted.push(c);
  }

  // ── PASS 3 — reserve refill (canonical-unique + cap-aware + substring-safe) ──
  if (accepted.length < CAP) {
    for (const raw of reserve) {
      if (accepted.length >= CAP) break;
      const tag = cleanTag(raw);
      if (!tag) continue;
      const canon = tagCanonical(tag);
      if (canonSeen.has(canon)) continue;
      const stems = tagStems(tag);
      const cand: Cand = {
        tag,
        stems,
        canon,
        core: stems.length > 0 ? stems[stems.length - 1] : tag,
      };
      if (isSubstringNearDup(cand)) continue;
      if (stems.some((s) => (stemCount.get(s) ?? 0) >= MAX_PER_STEM)) continue;
      canonSeen.add(canon);
      for (const s of stems) stemCount.set(s, (stemCount.get(s) ?? 0) + 1);
      accepted.push(cand);
    }
  }

  // ── PASS 4a — graceful cap relaxation: re-admit deferred (still canonical-
  //    UNIQUE *and* not a same-core substring near-dup of an accepted tag) ──
  if (accepted.length < CAP) {
    for (const c of capDeferred) {
      if (accepted.length >= CAP) break;
      // The cap relaxes here, but the substring near-dup guard does NOT —
      // never ship "gold ring" next to "band gold ring" just to hit 13.
      if (isSubstringNearDup(c)) continue;
      accepted.push(c);
      const idx = nearDropped.indexOf(c.tag);
      if (idx >= 0) nearDropped.splice(idx, 1); // kept after all
    }
  }
  // ── PASS 4b — last resort: relaxed reserve (canonical-unique + not a
  //    same-core substring near-dup, ignore cap) ──
  if (accepted.length < CAP) {
    for (const raw of reserve) {
      if (accepted.length >= CAP) break;
      const tag = cleanTag(raw);
      if (!tag) continue;
      const canon = tagCanonical(tag);
      if (canonSeen.has(canon)) continue;
      const stems = tagStems(tag);
      const cand: Cand = {
        tag,
        stems,
        canon,
        core: stems.length > 0 ? stems[stems.length - 1] : tag,
      };
      if (isSubstringNearDup(cand)) continue;
      canonSeen.add(canon);
      accepted.push(cand);
    }
  }

  const tags = accepted.slice(0, CAP).map((c) => c.tag);

  // Dev-only invariant: no canonical dup may ever leak. Turns a silent
  // regression into a loud test failure.
  if (process.env.NODE_ENV !== "production") {
    const seen = new Set<string>();
    for (const t of tags) {
      const k = tagCanonical(t);
      if (seen.has(k)) {
        throw new Error(`[enforceTagUniqueness] near-dup leaked: "${t}" canon="${k}"`);
      }
      seen.add(k);
    }
    // Same-core substring near-dups have a DIFFERENT canon, so the loop
    // above can't catch them ("gold ring" vs "band gold ring"). Assert
    // separately so the PASS-4 relaxation can never regress this class.
    for (let a = 0; a < tags.length; a++) {
      for (let b = a + 1; b < tags.length; b++) {
        const sa = tagStems(tags[a]);
        const sb = tagStems(tags[b]);
        const ca = sa.length > 0 ? sa[sa.length - 1] : tags[a];
        const cb = sb.length > 0 ? sb[sb.length - 1] : tags[b];
        if (
          ca === cb &&
          (tags[a].includes(tags[b]) || tags[b].includes(tags[a]))
        ) {
          throw new Error(
            `[enforceTagUniqueness] substring near-dup leaked: "${tags[a]}" <> "${tags[b]}"`,
          );
        }
      }
    }
  }

  return {
    tags,
    exactDropped,
    nearDropped,
    short: tags.length < CAP,
  };
}

// Export the canonical-form helper too — route.ts needs it for the
// serial swap-claim guard (see parallelSwapFix).
export { tagCanonical };

/**
 * Defensive description formatter. The system prompt asks Sonnet for
 * \n between bullets and \n\n between sections, but it sometimes
 * still returns one giant paragraph with inline `• ` markers. This
 * recovers the intended structure post-hoc so the description doesn't
 * render as a wall of text in the UI / on Etsy.
 *
 * Heuristic:
 *   1. Collapse Windows newlines.
 *   2. Wherever a "• " appears NOT preceded by a newline, insert a
 *      newline before it.
 *   3. Trim excessive blank lines (>2 consecutive newlines → 2).
 *
 * Idempotent: descriptions that were already well-formatted pass
 * through unchanged.
 */
function normalizeDescription(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/\r\n/g, "\n");
  // Insert a newline before every "• " that doesn't already have one
  // ahead of it. Handles "...palette. • Bodice features..." → "...palette.\n• Bodice features..."
  s = s.replace(/([^\n])\s*•\s*/g, "$1\n• ");
  // Ensure leading "• " on the very first bullet line if Sonnet started
  // the description with a bullet (rare but possible).
  s = s.replace(/^\s*•\s*/, "• ");
  // Collapse runs of 3+ newlines down to 2 (one blank line between
  // sections; bullet-to-bullet stays single \n).
  s = s.replace(/\n{3,}/g, "\n\n");
  // Strip trailing whitespace on each line.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
  return s;
}

function normalize(out: GeneratedListing, expectedAlts: number): GeneratedListing {
  const rawTitle = (out.title ?? "").trim();
  const title = stripMtoFromTitle(rawTitle).slice(0, ETSY_LIMITS.TITLE_MAX);

  // Tags: lowercase, trim, dedupe, clamp length, slice to 13.
  // Also drop any tag containing buyer-data-on-product wording
  // (personalised, customisable, monogram, "with name", etc.) — we
  // sell ready-stock with no input field so those tags would mislead
  // buyers. Everything else (handmade, hand-knit, custom made, made
  // to order, bespoke, engraved, etc.) is allowed — see MTO_PATTERNS.
  //
  // NEAR-DUPLICATE GUARD (May 19 2026, refined May 20):
  //   The same root-noun rephrased ("mermaid prom dress" + "mermaid prom
  //   gown" + "mermaid evening gown") was eating 3-4 tag slots for ONE
  //   keyword. We cap each significant-word stem at 3 tags so the 13
  //   slots cover distinct angles rather than four variants of the same
  //   noun.
  //
  //   May 20: bumped from 2 → 3 after CEO flagged 8/13 result on swimwear
  //   ("high waist bikini" + "bikini shorts set" + "beach swimsuit" +
  //   "drawstring swimsuit" hit cap on "bikini" and "swimsuit" stems,
  //   blocking 5 valid tags). Product niches NEED the core noun
  //   ("bikini", "swimwear", "dress") in most tags — capping at 2 leaves
  //   empty slots. 3 keeps diversity AND fills the 13-slot inventory.
  //
  //   FALLBACK PASS (May 20): if the stem cap leaves us with < 13 tags,
  //   we do a second pass over Sonnet's output without the cap, adding
  //   any tag that's only excluded by stems (still dropping MTO + dupes
  //   + over-length). Better to ship 13 slightly-similar tags than 8
  //   slots with 5 empty.
  const { tags } = enforceTagUniqueness(out.tags ?? []);

  const description = normalizeDescription(out.description ?? "").slice(
    0,
    ETSY_LIMITS.DESCRIPTION_MAX,
  );

  // Alt text — EXACTLY ONE general alt text for the whole listing.
  // CEO directive May 19 2026: the seller pastes the same alt onto
  // every variant image on Etsy, so per-image alts were unnecessary
  // noise. Anything Sonnet returns past index 0 is dropped. If it
  // returns an empty array, fall back to "" so the field still
  // exists in the shape downstream consumers expect.
  // `expectedAlts` arg is now ignored — kept on the signature for
  // backward-compat with the one caller in generateListing.
  void expectedAlts;
  const firstAlt = out.altTexts?.[0] ?? "";
  const altTexts: string[] = [
    firstAlt.toString().trim().slice(0, ETSY_LIMITS.ALT_TEXT_MAX),
  ];

  const rationale = {
    keywordFocus: (out.rationale?.keywordFocus ?? "").toString(),
    titleStrategy: (out.rationale?.titleStrategy ?? "").toString(),
    audienceHook: (out.rationale?.audienceHook ?? "").toString(),
  };

  return {
    title,
    description,
    tags,
    altTexts,
    rationale,
  };
}

function localRuleCheck(l: GeneratedListing): TextComplianceReport["issues"] {
  const issues: TextComplianceReport["issues"] = [];
  if (l.title.length > ETSY_LIMITS.TITLE_MAX) {
    issues.push({
      severity: "block",
      field: "title",
      message: `Title is ${l.title.length} chars (max ${ETSY_LIMITS.TITLE_MAX}).`,
    });
  }
  if (l.tags.length !== ETSY_LIMITS.TAG_COUNT) {
    issues.push({
      severity: "warn",
      field: "tags",
      message: `Etsy expects exactly ${ETSY_LIMITS.TAG_COUNT} tags — got ${l.tags.length}.`,
    });
  }
  l.tags.forEach((t) => {
    if (t.length > ETSY_LIMITS.TAG_MAX_CHARS) {
      issues.push({
        severity: "block",
        field: "tags",
        message: `Tag "${t}" is ${t.length} chars (max ${ETSY_LIMITS.TAG_MAX_CHARS}).`,
      });
    }
  });
  if (l.description.length > ETSY_LIMITS.DESCRIPTION_MAX) {
    issues.push({
      severity: "warn",
      field: "description",
      message: `Description is ${l.description.length} chars — Etsy caps at ${ETSY_LIMITS.DESCRIPTION_MAX}.`,
    });
  }
  return issues;
}

// ════════════════════════════════════════════════════════════════════
// PROMPT ENGINEER — AliExpress photo → Higgsfield image-gen prompt
// ════════════════════════════════════════════════════════════════════
//
// CEO workflow (2026-06-12): the team uploads an AliExpress product
// photo and needs a text-to-image prompt for Higgsfield that:
//   1. keeps the PRODUCT identical (read precisely from the photo)
//   2. swaps the model for a USA / Western, well-fitted model of the
//      chosen type (woman / man / girl / boy / kid)
//   3. uses a DIFFERENT pose than the source photo (never copy it)
//   4. stays CONSISTENT across a listing's 7-8 images via a locked
//      "model persona" generated once and reused on every later image
//
// Built on Haiku 4.5 (vision, cheap — see the cost analysis). The
// per-image-prompt cost is ~PKR 0.8; swapping to MODEL_GENERATOR
// (Sonnet) is a one-line change if prompt quality needs a bump.

export type PromptEngineerModelType =
  | "woman"
  | "man"
  | "girl"
  | "boy"
  | "kid";

export interface HiggsfieldPromptInput {
  /** The AliExpress product photo. */
  image: ImagePayload;
  /** Who should wear/hold the product in the generated images. */
  modelType: PromptEngineerModelType;
  /** Background setting, e.g. "studio white", "lifestyle indoor". */
  background?: string;
  /** Style / mood, e.g. "clean e-commerce", "editorial". */
  style?: string;
  /** Optional explicit pose. Empty = auto (always different from source). */
  pose?: string;
  /** Image orientation/ratio, e.g. "portrait", "square", "landscape". */
  orientation?: string;
  /** Free-text extra instruction from the employee. */
  freeText?: string;
  /**
   * Locked model persona for the listing. Pass null/empty on the FIRST
   * image of a listing — the model invents one and returns it. Pass it
   * back verbatim on every subsequent image so the SAME model appears
   * across all 7-8 photos.
   */
  modelPersona?: string | null;
}

export interface HiggsfieldPromptResult {
  /** The locked persona — store it client-side and resend for the next image. */
  modelPersona: string;
  /** Short summary of the product the vision model read from the photo. */
  productSummary: string;
  /** The ready-to-paste Higgsfield text-to-image prompt. */
  prompt: string;
  /** Suggested negative prompt (things to avoid). */
  negativePrompt: string;
}

const PROMPT_ENGINEER_SYSTEM = `You are a senior AI image-prompt engineer for an e-commerce brand. You look at a supplier's product photo and write a single, production-ready TEXT-TO-IMAGE prompt (for Higgsfield / any modern diffusion model) that recreates the SAME product on a fresh, Western model.

THE THREE HARD RULES (never break):

1. PRODUCT STAYS IDENTICAL. Read the product from the photo with forensic precision and describe it so the generator reproduces the exact same item: garment/object type, every color, fabric/material, pattern/print, neckline, sleeves, length, fit/silhouette, closures, straps, embellishments, hardware, text/graphics on it, trim. The product in the generated image must look like the SAME SKU the buyer will receive. Do NOT restyle, recolor, or "improve" the product.

2. SWAP THE MODEL to a USA / Western, attractive, well-fitted <model type>. Never describe the original photo's model. Use the LOCKED MODEL PERSONA provided (or, if none is provided, invent a specific, detailed one and return it). The persona must be concrete enough to reproduce the same-looking person every time: approximate age, ethnicity/look (default American / Western), face shape, skin tone, hair color + length + style, body build/height. Natural, healthy, catalog-appropriate.

3. CHANGE THE POSE. Never copy the pose from the source photo. If an explicit pose is given, use it. Otherwise choose a flattering, natural pose that shows the product well and differs clearly from a generic supplier shot.

ALSO:
- Apply the requested background, style/mood, and orientation.
- Photorealistic, professional fashion / e-commerce photography. Include camera + lighting cues (e.g. "85mm, soft diffused studio light, shallow depth of field") so output looks like a real product shoot.
- For kids/boys/girls: keep everything wholesome, age-appropriate, fully clothed, modest. No suggestive posing or wording, ever.
- The prompt should be one rich paragraph (roughly 60-130 words), not a bullet list.

OUTPUT — strict single-line minified JSON, no prose, no markdown, NO literal line breaks inside any value (write every field as one continuous line; keep modelPersona under ~60 words and prompt under ~130 words):
{"modelPersona":"the locked persona you used — detailed + reusable (echo the provided one verbatim if given)","productSummary":"1 sentence: what the product is, as read from the photo","prompt":"the full text-to-image prompt, one paragraph","negativePrompt":"comma-separated things to avoid: deformed hands, extra fingers, altered product, wrong colors, text artifacts, watermark, low quality, duplicate, mismatched garment"}`;

export async function generateHiggsfieldPrompt(
  input: HiggsfieldPromptInput,
  accum?: CostAccumulator,
): Promise<HiggsfieldPromptResult> {
  const hasPersona = !!(input.modelPersona && input.modelPersona.trim());

  const userText = [
    `Model type: ${input.modelType} (USA / Western, well-fitted, attractive, catalog-appropriate)`,
    input.background ? `Background: ${input.background}` : `Background: clean studio (choose what suits the product)`,
    input.style ? `Style / mood: ${input.style}` : `Style: clean professional e-commerce`,
    input.pose && input.pose.trim()
      ? `Pose: ${input.pose.trim()}`
      : `Pose: AUTO — pick a natural flattering pose DIFFERENT from the source photo`,
    input.orientation ? `Orientation: ${input.orientation}` : `Orientation: portrait`,
    input.freeText && input.freeText.trim()
      ? `Extra instructions from the team: ${input.freeText.trim()}`
      : null,
    hasPersona
      ? `LOCKED MODEL PERSONA (reuse this EXACT person for consistency across the listing — do not change it):\n${input.modelPersona!.trim()}`
      : `No locked persona yet — this is the FIRST image of the listing. INVENT a specific, detailed ${input.modelType} persona (USA / Western) and return it in modelPersona so the next images reuse the same person.`,
    ``,
    `Read the attached product photo and produce the JSON.`,
  ]
    .filter(Boolean)
    .join("\n");

  const userContent: ContentBlock[] = [
    ...toImageBlocks([input.image]),
    { type: "text", text: userText },
  ];

  const msg = await client().messages.create({
    model: MODEL_COMPLIANCE, // Haiku 4.5 — vision, cheap. Swap to MODEL_GENERATOR for max quality.
    // Headroom so the persona + paragraph prompt + negative never get
    // truncated mid-string (truncation → invalid JSON). 900 was too tight
    // for verbose personas (bug 2026-06-12).
    max_tokens: 1600,
    temperature: 0.7,
    system: [
      {
        type: "text",
        text: PROMPT_ENGINEER_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: userContent },
      { role: "assistant", content: "{" },
    ],
  });
  trackUsage(accum, msg, modelKindFromId(MODEL_COMPLIANCE));

  const parsed = parseHiggsfieldJson("{" + extractText(msg));

  // If the caller already had a persona, keep it authoritative so it
  // never drifts even if the model echoes it imperfectly.
  const modelPersona = hasPersona
    ? input.modelPersona!.trim()
    : (parsed.modelPersona ?? "").toString().trim();

  const prompt = (parsed.prompt ?? "").toString().trim();
  if (!prompt) {
    throw new Error(
      "the model didn't return a usable prompt — try again (Haiku occasionally returns malformed output).",
    );
  }

  return {
    modelPersona,
    productSummary: (parsed.productSummary ?? "").toString().trim(),
    prompt,
    negativePrompt: (parsed.negativePrompt ?? "").toString().trim(),
  };
}

/**
 * Tolerant parser for the Prompt Engineer JSON. LLM JSON for free-text
 * fields fails in two common ways: (1) RAW newlines/tabs inside a string
 * value (JSON forbids unescaped control chars), and (2) truncation that
 * leaves the object unclosed. This handles both:
 *   1. direct parse (slice to last brace)
 *   2. escape raw control chars that sit INSIDE string literals, retry
 *   3. per-field regex extraction as a last resort (survives truncation
 *      of later fields — we still recover the earlier ones)
 */
function parseHiggsfieldJson(text: string): Partial<HiggsfieldPromptResult> {
  const tryParse = (s: string): Partial<HiggsfieldPromptResult> | null => {
    const last = s.lastIndexOf("}");
    const cand = last >= 0 ? s.slice(0, last + 1) : s;
    try {
      return JSON.parse(cand) as Partial<HiggsfieldPromptResult>;
    } catch {
      return null;
    }
  };

  // 1. straight parse
  const direct = tryParse(text);
  if (direct) return direct;

  // 2. escape raw control chars that appear inside "..." string values
  const sanitized = escapeControlCharsInStrings(text);
  const fixed = tryParse(sanitized);
  if (fixed) return fixed;

  // 3. field-level salvage — pull each known field out individually
  const grab = (key: string): string => {
    const m = sanitized.match(
      new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
    );
    if (!m) return "";
    return m[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };
  const salvaged: Partial<HiggsfieldPromptResult> = {
    modelPersona: grab("modelPersona"),
    productSummary: grab("productSummary"),
    prompt: grab("prompt"),
    negativePrompt: grab("negativePrompt"),
  };
  if (salvaged.prompt || salvaged.modelPersona) return salvaged;

  throw new Error(
    `Claude returned unparseable output. First 200 chars: ${text.slice(0, 200)}`,
  );
}

/** Escape raw newline/return/tab characters that occur INSIDE JSON string
 *  literals (a simple in-string state machine) so JSON.parse accepts them.
 *  Structural whitespace between tokens is left untouched. */
function escapeControlCharsInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr) {
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
    }
    out += ch;
  }
  return out;
}
