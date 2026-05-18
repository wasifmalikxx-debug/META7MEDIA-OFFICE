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

  // Ask Haiku for 6 candidates (was 3). Some will fail the post-
  // filters (>20 chars, risky words, dupes), and we want to be able
  // to return 3 GOOD ones after filtering. Asking for 6 gives a
  // 2× buffer against rejections.
  const msg = await client().messages.create({
    model: MODEL_VALIDATOR, // Haiku — cheap, good at this kind of task
    max_tokens: 600,
    temperature: 0.4,
    system: `You are an Etsy SEO expert. Given a tag a seller wants to REPLACE, suggest 6 alternative tags.

🚫 ABSOLUTE HARD RULE — TAG LENGTH ≤20 CHARACTERS:
Etsy rejects any tag over 20 characters TOTAL (every letter + every space counts). You MUST count characters before outputting. If your candidate is 21+ chars, REWRITE it shorter or pick a completely different tag — NEVER output a tag over 20 chars even partially. Truncated phrases are USELESS to the seller.

Character counting examples (count every char including spaces):
  ✅ "boho earrings" = 13 chars — OK
  ✅ "wooden key holder" = 17 chars — OK
  ✅ "rustic key shelf" = 16 chars — OK
  ❌ "rustic key holder shelf" = 23 chars — TOO LONG, drop or shorten
  ❌ "minimalist gold drop" = 20 chars — OK at exactly 20
  ❌ "wooden wall key storage" = 23 chars — TOO LONG

If a long-tail phrase you want to suggest exceeds 20, either:
  (a) pick a tighter 2-3 word version that fits, or
  (b) abandon it entirely and choose a different angle.

OTHER RULES:
1. lowercase, no punctuation
2. Cover SIMILAR buyer intent to the one being replaced
3. Lean LONGER and more SPECIFIC (long-tail beats short-tail for new shops) — but STILL ≤20 chars
4. NOT already in the seller's existing tag list (avoid duplicates / near-duplicates)
5. NO brand names or trademarks (Disney, Marvel, Nike, etc.)
6. NO risky / Etsy-flag words: sexy, sensual, erotic, nude, weed, gun, etc. Use neutral descriptors instead.
7. NO buyer-data-on-product wording (we sell ready stock, no input field): no "personalized" / "personalised", no "customisable" / "customizable", no "monogram" / "monogrammed", no "with name" / "your name on". Everything else is fine — handmade, hand knit, hand stitched, custom made, made to order, bespoke, engraved are all ALLOWED (marketing/feature words, not buyer-data promises).
8. Vary in approach across the 6: niche-specific, expanded-context (gift/occasion), stylistic (material/aesthetic), audience-targeted, use-case, etc.

OUTPUT FORMAT — strict JSON, no prose. Output exactly 6 candidates so the seller has options:
{
  "replacements": [
    { "tag": "...", "reason": "1-line why this is a better choice" },
    { "tag": "...", "reason": "..." },
    { "tag": "...", "reason": "..." },
    { "tag": "...", "reason": "..." },
    { "tag": "...", "reason": "..." },
    { "tag": "...", "reason": "..." }
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

    // NO MORE TRUNCATION. Previously this was `.slice(0, 20)` which
    // silently chopped "wooden wall key storage" → "wooden wall key stor"
    // — garbage. Now we REJECT anything over 20 chars and rely on the
    // 2× buffer (asking for 6 to land 3) to absorb the loss.
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

    return deduped.slice(0, 3);
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
          // Gender / audience enforcement — drop keywords missing the
          // niche's required market-segment tokens.
          if (!keywordMatchesGenderRequirement(k, genderRequirements)) {
            droppedForGender++;
            return false;
          }
          return true;
        })
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
  altTexts: string[]; // one per image (matches images.length, or 1 if no images)
  rationale: {
    keywordFocus: string;
    titleStrategy: string;
    audienceHook: string;
  };
}

const GENERATOR_SYSTEM = `You are an elite Etsy SEO copywriter at META7MEDIA. You see product images + title + live ranking-listing data + ANCHOR KEYWORDS extracted from the top-20 winning listings. Your job: produce a complete, ORIGINAL Etsy listing that beats those competitors at their own ranking game.

============================================================
ETSY ALGORITHM PRIORITIES (most → least important)
============================================================
1. Title — especially the FIRST 40 characters (huge weight)
2. Tags — exact match beats partial match
3. Attributes — covered slots improve ranking
4. Description — adds long-tail keyword coverage
5. Materials — minor signal but free attribution

ANCHOR KEYWORDS rule (READ CAREFULLY):
The user message contains an "ANCHOR KEYWORDS" block — high-frequency phrases that appear in >50% of the top-ranking listings. These are PROVEN buyer-search terms. Front-load them in the title and lead with them in your tag list. Skipping them is leaving free ranking signal on the floor.

============================================================
CORE RULES
============================================================

1. NEVER copy a competitor's title/tags/description verbatim. Produce ORIGINAL English copy that captures the same buyer intent.

2. TITLE:
   • ≤ 140 characters total
   • Front-load 1-2 ANCHOR phrases in the first 40 chars
   • Use " | " or " · " separators, NEVER commas (commas split phrases in Etsy's matcher)
   • Each separator-delimited segment should be a SEARCHABLE phrase (2-4 words)
   • End with a buyer-intent hook based on AUDIENCE or OCCASION
     (good: "Gift for Her", "Bridesmaid Dress", "Wedding Guest Style",
      "Prom Night Outfit", "Date Night Look", "Holiday Party Dress",
      "Christmas Gift for Mom", "Mother's Day Gift")
   • Title length sweet spot: 100-140 chars (more chars = more keyword surface)

   NEVER use BUYER-DATA-ON-PRODUCT wording in the title. There's no
   input field for the buyer to type their own name/date/message,
   so promising it would mislead. Banned:
   • "Personalized" / "Personalised" / "Personalisation"
   • "Customisable" / "Customizable" / "Customization"
   • "Monogram" / "Monogrammed" (= buyer's initials)
   • "With Name" / "With Your Name" / "Printed With Name"
   • "Your Name On" / "Name On It"

   ALLOWED — these are marketing/material/descriptive words, NOT
   buyer-data promises. Use them freely if they fit the product:
   • Handcraft: "Handmade" / "Hand-Crafted" / "Hand Knit" / "Hand Stitched" / "Hand Sewn"
   • Production: "Custom Made" / "Custom Order" / "Custom Sized" /
     "Custom Fit" / "Made to Order" / "MTO"
   • Premium: "Bespoke" / "Artisan" / "Crafted"
   • Surface: "Engraved" (product can ship with pre-engraved
     decorative designs — that's a feature, not buyer-input)

3. TAGS:
   • Exactly 13. Each ≤ 20 characters.
   • Lowercase. No duplicates or near-duplicates ("leather wallet" + "leather wallets" = wasted slot).
   • Mix demand types: 5-6 high-volume (covering anchor keywords), 5-6 medium-volume long-tail, 2-3 niche
   • Multi-word tags (2-3 words) usually outperform single words on Etsy
   • Lead the array with the strongest anchor phrases

4. NO BANNED/TRADEMARKED TERMS:
   Disney, Marvel, Nike, Adidas, NFL/NBA/MLB team names, Pokemon, Harry Potter, Star Wars, Game of Thrones, real celebrity names, etc.

5. DESCRIPTION — 3 sections, structured with EXPLICIT newline characters:

   Section 1: HOOK — 1-2 lines, benefit-led, why this product matters
              to the buyer.
   (BLANK LINE — i.e. \\n\\n between sections)
   Section 2: FEATURES — 4-7 bullets. EACH BULLET ON ITS OWN LINE,
              starting with "• " (bullet + space), separated by a
              single \\n. Do NOT run bullets inline inside a paragraph.
   (BLANK LINE — \\n\\n)
   Section 3: CARE & SIZING note — 1 short paragraph, 2-3 sentences.

   The literal characters \\n MUST appear between every bullet and
   between every section in the JSON string. If you skip the
   newlines, Etsy renders the description as one wall of text with
   stray • characters and buyers bounce.

   Total target length: 600-1500 chars. Long-tail keywords sprinkled
   naturally.

   EXAMPLE of correctly-formatted description (note the \\n escapes):

   "A breathtaking gown that captures storybook royalty.\\n\\n• Lace-up corset bodice in gradient ombré tones\\n• Puffed short sleeves with sheer mesh overlay\\n• Full A-line skirt in lustrous satin\\n• Floor-length silhouette for dramatic stage presence\\n\\nGentle hand-wash in cold water, hang to dry. Store flat or on a padded hanger to preserve the bodice structure."

   NEVER write shipping time, processing time, dispatch time, or any
   "ships in X days" / "ready to ship in X business days" / "ships
   ready to wear within X-X business days" / "delivery in X weeks"
   language. Etsy's shop settings handle delivery promises — putting
   timing in the description creates conflicting promises and TOS risk.
   The description must be silent on shipping / processing / dispatch.

   NEVER use character-defining trait wording even when reframing
   away from the IP. For Rapunzel-style products: ban "long-haired",
   "long braid", "golden braid", "magic hair". For Snow White-style:
   ban "raven-haired", "red apple", "seven dwarfs". For Frozen-style:
   ban "ice queen", "snow queen", "frozen kingdom". The reframed
   description must read as a generic fairy-tale / fantasy item, not
   "a thinly-veiled <character>".

6. VARIATIONS:
   If sizes and/or variants were supplied, mention them ONCE in the description in a natural way that fits the actual axis ("Available in XS-XXL and 5 colors", "Available in 3 phone models and 4 designs", "Comes in gold, silver, and rose gold"). Do NOT put them in title or tags — Etsy handles them as separate variation fields.

7. IMAGE ALT TEXTS:
   ONE per image you see (matching the image count). ≤ 250 chars each.

   CRITICAL — the seller reuses the SAME alt text across every colour
   and variation of this listing on Etsy. So your alt text must work
   equally well for the blue version AND the white version AND the
   black version AND every future variant.

   NEVER include:
   • Specific colour words: blue, white, black, red, pink, gold, rose
     gold, ivory, navy, sage, emerald, beige, etc.
   • Colour qualifiers: pastel, soft, deep, creamy, dusty, light, dark
   • Variant-specific pattern words: polka dot, floral print, striped,
     paisley, tartan (skip these even if visible — same alt has to fit
     the plain version)

   DO include (these stay constant across variants):
   • Material: lace, satin, linen, cotton, leather, ceramic, etc.
   • Silhouette: fitted bodice, A-line, mermaid, oversized, slim fit
   • Construction: strapless, sweetheart neckline, high slit, V-neck
   • Length / size class: floor length, midi, knee length, ankle
   • Texture / surface: sheer mesh overlay, embroidered, pleated,
     embossed, distressed, hammered
   • Function / use: evening, formal, prom, gala, wedding guest

   Front-load the primary product noun (good for image SEO). Example:
     ✓ "Lace evening gown strapless sweetheart bodice high slit floor length formal prom dress sheer mesh overlay floral appliqués"
     ✗ "Blue lace evening gown ..." (the word "blue" makes it wrong for every non-blue variant of this same listing)

============================================================
GOOD vs BAD TITLE EXAMPLES
============================================================

❌ BAD (commas split phrases, generic, buyer-data promise):
   "Pretty Dress, Off Shoulder, for Women, Personalised With Name"

✅ GOOD (anchor "off shoulder prom dress" front-loaded, "|" separators,
        audience/occasion intent hook, no buyer-data promises):
   "Off Shoulder Prom Dress | Pearl Sweetheart Neckline Formal Gown | Wedding Guest Style Bridesmaid Dress"

❌ BAD tags (duplicates wasting slots, buyer-data promises):
   ["dress", "dresses", "prom dress", "prom dresses",
    "personalised dress", "monogrammed dress", "customisable prom", ...]

✅ GOOD tags (mix of volumes, no dupes, anchor keywords prioritized,
        no personalised/customisable/monogram tags):
   ["off shoulder dress", "prom dress", "sweetheart gown", "pearl bodice",
    "wedding guest dress", "satin prom gown", "formal evening dress",
    "bridesmaid dress", "elegant prom gown", "ball gown dress",
    "long formal dress", "gala dress", "homecoming dress"]

============================================================
OUTPUT FORMAT — strict JSON, NO prose, NO markdown fences
============================================================

{
  "title": "string ≤140 chars",
  "description": "string with \\n\\n between sections AND \\n between every bullet — see DESCRIPTION rule above for the exact shape",
  "tags": ["...", ... exactly 13 items],
  "altTexts": ["...", "..."],
  "rationale": {
    "keywordFocus": "1 line — which anchor keyword(s) you anchored on and why",
    "titleStrategy": "1 line — what your title does for ranking (front-load, hook, length)",
    "audienceHook": "1 line — which buyer this targets + what triggers their click"
  }
}`;

// ─── Writing-voice variety ───────────────────────────────────────
//
// Same product + same Sonnet model = nearly identical output every
// time. Two employees generating the same listing got 80% overlap
// in title/description/tags. To break that uniformity, every
// generation picks a random voice from this list and tells Sonnet
// to write in that tone. Lives in the USER prompt (not system) so
// it doesn't invalidate the system-prompt cache.

const GENERATOR_VOICES: { name: string; instruction: string }[] = [
  {
    name: "warm-storyteller",
    instruction:
      "WARM STORYTELLING. Lead the description with an emotional hook — paint the moment when this item arrives, who it's for, why they'll smile when they unbox it. Use sensory language (texture, weight, warmth). The opening section should feel like the start of a small story.",
  },
  {
    name: "lifestyle-aspirational",
    instruction:
      "ASPIRATIONAL LIFESTYLE. Show the buyer the scene this product creates — the morning ritual, the dinner-party moment, the daily upgrade. Lead with the *life* this enables, not the product specs. Make them want to BE that person.",
  },
  {
    name: "practical-specs-first",
    instruction:
      "PRACTICAL SPECS-FIRST. Lead the description with concrete features — material, dimensions, what makes it functionally distinct. Buyer-confidence comes from clarity. Direct, no fluff, no purple prose.",
  },
  {
    name: "designer-aesthetic",
    instruction:
      "DESIGNER AESTHETIC. Focus on materials, color story, texture, silhouette, the visual language. Use words a fashion editor or interior designer would actually use. Detail-oriented and sophisticated, never generic.",
  },
  {
    name: "playful-casual",
    instruction:
      "PLAYFUL CASUAL. Friendly, conversational, like a recommendation from a stylish friend. Use 'you' freely. Drop the formal tone — have personality. Make the reader smirk a little.",
  },
  {
    name: "premium-minimalist",
    instruction:
      "PREMIUM MINIMALIST. Short sentences. Punchy bullets. Confident. Quality over quantity in every line. Skip filler words. The kind of copy that appears on a luxury brand's product page — restrained and assured.",
  },
  {
    name: "occasion-focused",
    instruction:
      "OCCASION-FOCUSED. Lead with WHEN the buyer would use this — gift moments, life events, daily rituals. Recipient-centric: think about who this is for, not just what it is. Make the description feel like a gift-guide entry.",
  },
  {
    name: "detail-expert",
    instruction:
      "DETAILED EXPERT. Comprehensive feature breakdown, construction details, materials vocabulary. The buyer wants confidence that the product is well-made and the seller knows what they're talking about. Authoritative and thorough.",
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
  const phrasesBlock = input.anchorKeywords.topPhrases
    .map(
      (p) =>
        `   • "${p.phrase}" (${p.count}/${input.anchorKeywords.totalListings} listings, ${p.percentage}%)`,
    )
    .join("\n");
  const tagsBlock = input.anchorKeywords.topTags
    .map(
      (t) =>
        `   • ${t.phrase} (${t.count}/${input.anchorKeywords.totalListings} listings)`,
    )
    .join("\n");
  const anchorBlock =
    input.anchorKeywords.topPhrases.length > 0 ||
    input.anchorKeywords.topTags.length > 0
      ? `# ANCHOR KEYWORDS — proven buyer-search terms from the top ${input.anchorKeywords.totalListings} listings

These phrases / tags appear repeatedly in winning listings for this keyword space. Front-load them in your title (especially the first 40 chars) and lead with them in your tag set.

Top phrases (titles):
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
- altTexts: ${input.images.length || 1} items

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
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of out.tags ?? []) {
    const t = (raw ?? "")
      .toString()
      .trim()
      .toLowerCase()
      .slice(0, ETSY_LIMITS.TAG_MAX_CHARS);
    if (!t || seen.has(t)) continue;
    if (tagLooksLikeMto(t)) continue; // safety net for MTO wording
    seen.add(t);
    tags.push(t);
    if (tags.length === ETSY_LIMITS.TAG_COUNT) break;
  }

  const description = normalizeDescription(out.description ?? "").slice(
    0,
    ETSY_LIMITS.DESCRIPTION_MAX,
  );

  // Alt texts — clamp each to 250 chars, pad/truncate to expected count.
  const altTexts: string[] = [];
  const targetCount = Math.max(1, expectedAlts);
  for (let i = 0; i < targetCount; i++) {
    const raw = out.altTexts?.[i] ?? "";
    altTexts.push(raw.toString().trim().slice(0, ETSY_LIMITS.ALT_TEXT_MAX));
  }

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
