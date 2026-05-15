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

  const msg = await client().messages.create({
    model: MODEL_VALIDATOR, // Haiku — cheap, good at this kind of task
    max_tokens: 400,
    temperature: 0.4,
    system: `You are an Etsy SEO expert. Given a tag a seller wants to REPLACE, suggest 3 alternative tags that:
1. Are ≤20 characters each, lowercase, no punctuation
2. Cover SIMILAR buyer intent to the one being replaced
3. Lean LONGER and more SPECIFIC (long-tail beats short-tail for new shops)
4. Are NOT already in the seller's existing tag list (avoid duplicates / near-duplicates)
5. NO brand names or trademarks (Disney, Marvel, Nike, etc.)
6. Vary in approach: one go-after-niche (very specific), one expanded-context (gift / occasion / recipient), one stylistic (material / aesthetic)

OUTPUT FORMAT — strict JSON, no prose:
{
  "replacements": [
    { "tag": "...", "reason": "1-line why this is a better choice" },
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

Suggest 3 replacement tags.`,
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
    return (parsed.replacements ?? [])
      .map((r) => ({
        tag: (r.tag ?? "").toString().trim().toLowerCase().slice(0, 20),
        reason: (r.reason ?? "").toString().trim().slice(0, 150),
      }))
      .filter(
        (r) =>
          r.tag.length >= 3 &&
          !existingLower.has(r.tag) &&
          r.tag !== opts.currentTag.toLowerCase(),
      )
      .slice(0, 3);
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

   NEVER use production / fulfillment / customization wording in the
   title. This is a READY-MADE dropshipping operation — we ship from
   existing stock, we do NOT make anything to order. Banned phrases:
   • "Made to Order" / "Made-to-Order" / "MTO"
   • "Custom Made" / "Custom Order" / "Custom-Made"
   • "Personalized" / "Personalised" (unless the product literally has
     a personalization input — which ours doesn't)
   • "Handmade" / "Hand-Crafted" / "Bespoke"
   • "Hand Sewn" / "Made by Hand" / "Hand-Made to Order"
   • "Custom Sized" / "Custom Fit" / "Sized to Order"
   These imply custom craft on demand and put us in TOS conflict when
   Etsy notices we're actually drop-shipping ready stock.

3. TAGS:
   • Exactly 13. Each ≤ 20 characters.
   • Lowercase. No duplicates or near-duplicates ("leather wallet" + "leather wallets" = wasted slot).
   • Mix demand types: 5-6 high-volume (covering anchor keywords), 5-6 medium-volume long-tail, 2-3 niche
   • Multi-word tags (2-3 words) usually outperform single words on Etsy
   • Lead the array with the strongest anchor phrases

4. NO BANNED/TRADEMARKED TERMS:
   Disney, Marvel, Nike, Adidas, NFL/NBA/MLB team names, Pokemon, Harry Potter, Star Wars, Game of Thrones, real celebrity names, etc.

5. DESCRIPTION — 3 sections, separated by a blank line:
   Section 1: HOOK (1-2 lines, benefit-led, why this product matters to the buyer)
   Section 2: FEATURES (4-7 bullets starting with "•" of specific details visible in the image)
   Section 3: CARE & SIZING note (1 short paragraph, 2-3 sentences)
   Total target length: 600-1500 chars. Long-tail keywords sprinkled naturally.

   NEVER write shipping time, processing time, dispatch time, or any
   "ships in X days" / "ready to ship in X business days" / "ships
   ready to wear within X-X business days" / "delivery in X weeks"
   language. Etsy's shop settings handle delivery promises — putting
   timing in the description creates conflicting promises and TOS risk.
   The description must be silent on shipping / processing / dispatch.

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

❌ BAD (commas, generic, made-to-order wording):
   "Pretty Dress, Off Shoulder, for Women, Custom Made to Order"

✅ GOOD (anchor "off shoulder prom dress" front-loaded, "|" separators,
        audience/occasion intent hook, NO production wording):
   "Off Shoulder Prom Dress | Pearl Sweetheart Neckline Formal Gown | Wedding Guest Style Bridesmaid Dress"

❌ BAD tags (duplicates wasting slots, made-to-order wording):
   ["dress", "dresses", "prom dress", "prom dresses",
    "made to order dress", "custom prom dress", ...]

✅ GOOD tags (mix of volumes, no dupes, anchor keywords prioritized,
        NO custom/MTO/handmade tags):
   ["off shoulder dress", "prom dress", "sweetheart gown", "pearl bodice",
    "wedding guest dress", "satin prom gown", "formal evening dress",
    "bridesmaid dress", "elegant prom gown", "ball gown dress",
    "long formal dress", "gala dress", "homecoming dress"]

============================================================
OUTPUT FORMAT — strict JSON, NO prose, NO markdown fences
============================================================

{
  "title": "string ≤140 chars",
  "description": "string, multi-line OK",
  "tags": ["...", ... exactly 13 items],
  "altTexts": ["...", "..."],
  "rationale": {
    "keywordFocus": "1 line — which anchor keyword(s) you anchored on and why",
    "titleStrategy": "1 line — what your title does for ranking (front-load, hook, length)",
    "audienceHook": "1 line — which buyer this targets + what triggers their click"
  }
}`;

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

  return `# Source title
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

Now produce the listing JSON.`;
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
    temperature: 0.65,
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

// Phrases that imply custom-craft-on-demand production. META7MEDIA is a
// READY-MADE dropshipping operation — these are TOS-conflicting + always
// wrong on our listings. Stripped from titles + dropped from tags as a
// safety net even if Sonnet ignores the rule in the system prompt.
const MTO_PATTERNS = [
  /\b(made[\s-]to[\s-]order)\b/gi,
  /\bMTO\b/g,
  /\b(custom[\s-]?made|custom[\s-]?order|custom[\s-]?sized|custom[\s-]?fit|made[\s-]custom|sized[\s-]to[\s-]order)\b/gi,
  /\b(personali[sz]ed)\b/gi,
  /\b(hand[\s-]?made|hand[\s-]?crafted|hand[\s-]?sewn|hand[\s-]?made[\s-]to[\s-]order|made[\s-]by[\s-]hand)\b/gi,
  /\b(bespoke)\b/gi,
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

function normalize(out: GeneratedListing, expectedAlts: number): GeneratedListing {
  const rawTitle = (out.title ?? "").trim();
  const title = stripMtoFromTitle(rawTitle).slice(0, ETSY_LIMITS.TITLE_MAX);

  // Tags: lowercase, trim, dedupe, clamp length, slice to 13.
  // Also drop any tag containing made-to-order / custom / handmade
  // wording — we sell ready-stock, those tags would mislead buyers.
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

  const description = (out.description ?? "").slice(0, ETSY_LIMITS.DESCRIPTION_MAX);

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
