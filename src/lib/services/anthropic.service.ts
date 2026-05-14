/**
 * Anthropic Claude client for SEO Autopilot.
 *
 * Four-stage pipeline:
 *
 *   0. HAIKU extracts search context from the raw AliExpress title
 *      (keyword + product type). Drives the Etsy search.
 *
 *   1. SONNET (vision) gatekeeps — looks at the regenerated product
 *      images + title and decides whether the product is even allowed
 *      on Etsy. If BLOCKED (trademark, prohibited item, counterfeit,
 *      adult-in-wrong-category), the pipeline stops here and no listing
 *      is generated.
 *
 *   2. SONNET (vision) writes the full listing — title, 13 tags,
 *      description, materials, every category attribute, alt text per
 *      image, suggested type/when-made/who-made-it/what-is-it,
 *      personalization instructions if requested.
 *
 *   3. HAIKU audits the generated TEXT for things vision can't catch
 *      (banned terms in title/tags, length violations, etc.).
 *
 * Output is forced into strict JSON via the prefilled-`{` trick + a
 * schema-shaped system prompt. We then JSON.parse and normalize.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CompetitorBrief, AnchorKeywords } from "./etsy-api.service";

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
const MODEL_COMPLIANCE = "claude-sonnet-4-5-20250929"; // Sonnet — strict, vision
const MODEL_VALIDATOR = "claude-haiku-4-5-20251001"; // Haiku — cheap text checks

// ─── Etsy listing rules — the source of truth for output validation ──

export const ETSY_LIMITS = {
  TITLE_MAX: 140,
  TAG_MAX_CHARS: 20,
  TAG_COUNT: 13,
  DESCRIPTION_MAX: 5000,
  MATERIALS_MAX: 13,
  ALT_TEXT_MAX: 250,
  PERSONALIZATION_MAX: 256,
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
  notes?: string,
): Promise<ExtractedContext> {
  const userPrompt =
    notes && notes.trim()
      ? `AliExpress / source title:\n${rawTitle}\n\nExtra notes from the seller:\n${notes}`
      : `AliExpress / source title:\n${rawTitle}`;

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

  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<ExtractedContext>(raw);

  return {
    searchKeyword: (parsed.searchKeyword ?? "").trim().slice(0, 80),
    productType: (parsed.productType ?? "").trim().slice(0, 40),
    audienceHint: (parsed.audienceHint ?? "").trim().slice(0, 80),
    styleHint: (parsed.styleHint ?? "").trim().slice(0, 80),
  };
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
export async function pickCategoryFromCandidates(opts: {
  title: string;
  productType: string;
  candidates: Array<{ id: number; name: string; path: string }>;
}): Promise<number | null> {
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

export async function checkProductCompliance(opts: {
  title: string;
  notes?: string;
  images: ImagePayload[];
}): Promise<ComplianceVerdict> {
  const { title, notes, images } = opts;

  // Build a multimodal content array: images first, then the text prompt.
  const userContent: ContentBlock[] = [];

  if (images.length > 0) {
    userContent.push(...toImageBlocks(images));
  }

  userContent.push({
    type: "text",
    text: `Product title (from AliExpress / source):
${title}

${notes && notes.trim() ? `Seller notes:\n${notes}\n\n` : ""}Review the product image(s) above and the title. Decide whether this product is allowed on Etsy. Be strict — if you can see ANY trademark, IP, or prohibited element, BLOCK it.`,
  });

  const msg = await client().messages.create({
    model: MODEL_COMPLIANCE,
    max_tokens: 800,
    temperature: 0,
    // System prompt is large + static (~2.5k tokens) → cache it. First
    // call writes the cache (~25% surcharge), every subsequent call
    // within 5 min reads it at ~10% of nominal input cost. With one
    // active CEO + team rollout, payback is ~2 calls.
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
  /** Free-text notes the seller wants emphasized. */
  notes?: string;
  /** Up to 2 regenerated product images. */
  images: ImagePayload[];
  /** Confirmed Etsy taxonomy node we're targeting. */
  category: { id: number; name: string; path: string };
  /** Live ranking-1..20 competitors for our keyword. */
  competitors: CompetitorBrief[];
  /** High-frequency phrases + tags extracted from the competitors. */
  anchorKeywords: AnchorKeywords;
  /** Required + optional attribute slots for this category. */
  attributeSchema: {
    name: string;
    displayName: string;
    required: boolean;
    possibleValues: string[];
  }[];
  /** Audience / style hints (from Stage 0). */
  audience?: string;
  style?: string;
  /** Optional employee-provided variations. */
  sizes?: string[];
  colors?: string[];
  /** Personalization spec. */
  hasPersonalization?: boolean;
  personalizationOptions?: string;
}

export interface GeneratedListing {
  title: string;
  description: string;
  tags: string[]; // exactly 13
  materials: string[]; // up to 13
  attributes: { name: string; value: string }[]; // category-driven
  altTexts: string[]; // one per image (matches images.length, or 1 if no images)
  personalizationInstructions: string; // empty string if not applicable
  suggestedType: "physical" | "digital";
  suggestedWhoMadeIt: "i_did" | "someone_else" | "collective";
  suggestedWhatIsIt: "finished_product" | "supply";
  suggestedWhenMade: string; // "made_to_order" | "2020_2026" | year string
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
   • End with a buyer-intent hook ("for him", "gift for mom", "made to order")
   • Title length sweet spot: 100-140 chars (more chars = more keyword surface)

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
   Section 2: FEATURES (4-7 bullets starting with "•" of specific attributes visible in the image)
   Section 3: CARE / SIZING / SHIPPING note (1 short paragraph, 2-3 sentences)
   Total target length: 600-1500 chars. Long-tail keywords sprinkled naturally.

6. CATEGORY ATTRIBUTES:
   Fill from the supplied possibleValues list. Cover BOTH required AND optional attributes when confident — more attributes = better Etsy ranking. Skip any slot you can't pick a confident value for.

7. VARIATIONS:
   If sizes/colors were supplied, mention them ONCE in the description ("Available in XS-XXL and 5 colors"). Do NOT put them in title or tags — Etsy handles them as separate variation fields.

8. PERSONALIZATION:
   If hasPersonalization is true, write the personalizationInstructions field — the prompt buyers see when ordering. Example: "Please leave the name to be engraved on the inside band. Max 12 characters, any letter, number or standard symbol."

9. IMAGE ALT TEXTS:
   ONE per image you see (matching the image count). ≤ 250 chars each. Describe color, material, style, key features. Front-load the primary keyword (good for image SEO).

10. ETSY METADATA SUGGESTIONS:
    • suggestedType: "physical" for tangible goods, "digital" for downloadables
    • suggestedWhoMadeIt: "i_did" if handmade/personal, "someone_else" if mass-produced, "collective" if small team
    • suggestedWhatIsIt: "finished_product" for ready-to-buy, "supply" for materials/tools
    • suggestedWhenMade: "made_to_order" for personalized/custom, "2020_2026" for current inventory

============================================================
GOOD vs BAD TITLE EXAMPLES
============================================================

❌ BAD (commas, generic, no anchors front-loaded):
   "Pretty Dress, Off Shoulder, for Women, Custom"

✅ GOOD (anchor "off shoulder prom dress" front-loaded, "|" separators, intent hook):
   "Off Shoulder Prom Dress | Pearl Sweetheart Neckline Formal Gown | Made to Order Wedding Guest Dress"

❌ BAD tags (duplicates wasting slots):
   ["dress", "dresses", "prom dress", "prom dresses", ...]

✅ GOOD tags (mix of volumes, no dupes, anchor keywords prioritized):
   ["off shoulder dress", "prom dress", "sweetheart gown", "pearl bodice",
    "wedding guest dress", "satin prom gown", "formal evening dress",
    "made to order dress", "custom prom dress", "elegant prom gown",
    "ball gown dress", "bridesmaid dress", "long formal dress"]

============================================================
OUTPUT FORMAT — strict JSON, NO prose, NO markdown fences
============================================================

{
  "title": "string ≤140 chars",
  "description": "string, multi-line OK",
  "tags": ["...", ... exactly 13 items],
  "materials": ["...", "..."],
  "attributes": [{"name": "Style", "value": "Vintage"}, ...],
  "altTexts": ["...", "..."],
  "personalizationInstructions": "string (empty if no personalization)",
  "suggestedType": "physical" | "digital",
  "suggestedWhoMadeIt": "i_did" | "someone_else" | "collective",
  "suggestedWhatIsIt": "finished_product" | "supply",
  "suggestedWhenMade": "made_to_order" | "2020_2026" | "2010_2019" | "2000_2009",
  "rationale": {
    "keywordFocus": "1 line — which anchor keyword(s) you anchored on and why",
    "titleStrategy": "1 line — what your title does for ranking (front-load, hook, length)",
    "audienceHook": "1 line — which buyer this targets + what triggers their click"
  }
}`;

function buildGeneratorUserPrompt(input: GenerationInput): string {
  const competitorBlock = input.competitors
    .slice(0, 20)
    .map(
      (c) =>
        `#${c.rank} (${c.favorites} favs) — ${c.title}\n   tags: ${c.tags.slice(0, 13).join(", ") || "n/a"}`,
    )
    .join("\n\n");

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

  const attributeBlock = input.attributeSchema
    .map((a) => {
      const vals =
        a.possibleValues.length > 0
          ? `   possible values: ${a.possibleValues.slice(0, 30).join(" / ")}${a.possibleValues.length > 30 ? " ..." : ""}`
          : "   (free-text)";
      return `- ${a.displayName}${a.required ? " (REQUIRED)" : ""}\n${vals}`;
    })
    .join("\n");

  const variationsBlock: string[] = [];
  if (input.sizes && input.sizes.length > 0) {
    variationsBlock.push(`Available sizes: ${input.sizes.join(", ")}`);
  }
  if (input.colors && input.colors.length > 0) {
    variationsBlock.push(`Available colors: ${input.colors.join(", ")}`);
  }
  if (input.hasPersonalization) {
    variationsBlock.push(
      `Personalization: YES${input.personalizationOptions ? ` — ${input.personalizationOptions}` : ""}`,
    );
  } else {
    variationsBlock.push("Personalization: NO");
  }

  return `# Source title
${input.productBrief}

${input.notes && input.notes.trim() ? `# Seller notes\n${input.notes}\n\n` : ""}# Target Etsy category
${input.category.path}  (taxonomy_id: ${input.category.id})

# Audience / style hints
${input.audience ? `Audience: ${input.audience}` : "Audience: (infer from images + title)"}
${input.style ? `Style: ${input.style}` : "Style: (infer from images)"}

# Variations & options
${variationsBlock.join("\n")}

${anchorBlock}# Live Etsy ranking data — full top 20 for this keyword space

Reference only — DON'T copy phrasing. Identify recurring keywords and write something ORIGINAL that targets the same buyer better.

${competitorBlock || "(no competitor data — generate based on the brief alone)"}

# Category attribute schema
Fill the slots below using realistic values. Use ONLY values from the possible-values list when one is provided. Skip slots you cannot confidently fill.

${attributeBlock || "(no defined attributes for this category — return an empty attributes array)"}

# Output count expected
- altTexts: ${input.images.length || 1} items
- attributes: as many as you can confidently fill from the schema above

Now produce the listing JSON.`;
}

export async function generateListing(
  input: GenerationInput,
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
            materials: listing.materials,
            attributes: listing.attributes,
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

function normalize(out: GeneratedListing, expectedAlts: number): GeneratedListing {
  const title = (out.title ?? "").trim().slice(0, ETSY_LIMITS.TITLE_MAX);

  // Tags: lowercase, trim, dedupe, clamp length, slice to 13.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of out.tags ?? []) {
    const t = (raw ?? "")
      .toString()
      .trim()
      .toLowerCase()
      .slice(0, ETSY_LIMITS.TAG_MAX_CHARS);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
    if (tags.length === ETSY_LIMITS.TAG_COUNT) break;
  }

  const description = (out.description ?? "").slice(0, ETSY_LIMITS.DESCRIPTION_MAX);

  const materials = (out.materials ?? [])
    .map((m) => (m ?? "").toString().trim())
    .filter(Boolean)
    .slice(0, ETSY_LIMITS.MATERIALS_MAX);

  const attributes = (out.attributes ?? [])
    .filter((a) => a && a.name && a.value)
    .map((a) => ({
      name: a.name.toString().trim(),
      value: a.value.toString().trim(),
    }));

  // Alt texts — clamp each to 250 chars, pad/truncate to expected count.
  const altTexts: string[] = [];
  const targetCount = Math.max(1, expectedAlts);
  for (let i = 0; i < targetCount; i++) {
    const raw = out.altTexts?.[i] ?? "";
    altTexts.push(raw.toString().trim().slice(0, ETSY_LIMITS.ALT_TEXT_MAX));
  }

  const personalizationInstructions = (out.personalizationInstructions ?? "")
    .toString()
    .trim()
    .slice(0, ETSY_LIMITS.PERSONALIZATION_MAX);

  // Clamp Etsy enum suggestions to known values.
  const suggestedType: GeneratedListing["suggestedType"] =
    out.suggestedType === "digital" ? "digital" : "physical";
  const suggestedWhoMadeIt: GeneratedListing["suggestedWhoMadeIt"] =
    out.suggestedWhoMadeIt === "someone_else"
      ? "someone_else"
      : out.suggestedWhoMadeIt === "collective"
        ? "collective"
        : "i_did";
  const suggestedWhatIsIt: GeneratedListing["suggestedWhatIsIt"] =
    out.suggestedWhatIsIt === "supply" ? "supply" : "finished_product";
  const suggestedWhenMade = (out.suggestedWhenMade ?? "made_to_order")
    .toString()
    .trim();

  const rationale = {
    keywordFocus: (out.rationale?.keywordFocus ?? "").toString(),
    titleStrategy: (out.rationale?.titleStrategy ?? "").toString(),
    audienceHook: (out.rationale?.audienceHook ?? "").toString(),
  };

  return {
    title,
    description,
    tags,
    materials,
    attributes,
    altTexts,
    personalizationInstructions,
    suggestedType,
    suggestedWhoMadeIt,
    suggestedWhatIsIt,
    suggestedWhenMade,
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
