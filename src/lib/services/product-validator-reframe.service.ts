/**
 * Product Validator — AI reframe pipeline.
 *
 * When the rule engine returns REVIEW (soft-flag — IP, brand,
 * Creativity Standards, or combat-terminology in costume context),
 * this service calls Claude Haiku 4.5 with the four Etsy policies
 * as system context and produces an Etsy-safe listing STRATEGY —
 * not concrete title / tag / description content, just the guidance
 * the employee needs to write a safe listing themselves (or feed
 * to SEO Autopilot, which handles the concrete generation).
 *
 * Output is strategy + coaching:
 *
 *   - listingApproach     — one paragraph framing the overall direction
 *   - titleGuidance       — bullet rules for writing the title
 *   - tagGuidance         — bullet rules for selecting tags
 *   - descriptionGuidance — bullet rules for writing the description
 *   - avoidWords          — explicit list of words/phrases to never use
 *   - photoGuidance       — do / don't for the identity-shot regen pass
 *
 * Separation of concerns: this tool tells the team HOW to list a
 * flagged product. SEO Autopilot writes the actual content.
 *
 * Cost: ~$0.003 text-only, ~$0.006 with vision (one Haiku call per
 * validation, total). The rule engine still gates BLOCKED products
 * without spending a cent on AI.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ValidationFlag } from "./product-validator.service";

// ─── Anthropic client ────────────────────────────────────────────────

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

// Pinned snapshot — Haiku 4.5 vision-capable, $1/$5 per M tokens
const MODEL = "claude-haiku-4-5-20251001";

// ─── Result shape ────────────────────────────────────────────────────

export interface PhotoRiskNote {
  /** What about the original AE photo is risky to recreate. */
  dont: string[];
  /** Safer alternatives for the identity-shot pass. */
  do: string[];
}

export interface ReframeResult {
  /** One paragraph framing the overall listing direction. */
  listingApproach: string;
  /** Bullet-point rules for writing the title. */
  titleGuidance: string[];
  /** Bullet-point rules for selecting tags. */
  tagGuidance: string[];
  /** Bullet-point rules for writing the description. */
  descriptionGuidance: string[];
  /** Exact words/phrases the seller must NOT include anywhere. */
  avoidWords: string[];
  /** Photo regeneration coaching (always populated). */
  photoGuidance: PhotoRiskNote;
  /** Whether photo vision actually fired (informs the UI badge). */
  visionUsed: boolean;
  /** Diagnostic — model id + cost for tracking. */
  modelId: string;
  costUsd: number;
}

// ─── Etsy policy context — embedded as system prompt ─────────────────
//
// Condensed from Etsy's public Seller Handbook + Help pages. Kept short
// so we don't burn tokens on every call. The full policy URLs are
// linked in the citations the rule engine emits.

const ETSY_POLICIES_SYSTEM = `You are an Etsy compliance advisor for a dropshipping team in Pakistan.
The team sources products from AliExpress, regenerates all product photos with new identity shots before listing, and writes their own listing content (or uses an SEO-generation tool) before posting on Etsy.

TEAM NICHE BOOK (what they actually source) — use this to pick the right audience + occasion framing per product:

  CLOTHING (adult)        Women / Mens / Linen / Beachwear / Swimsuits / Shapewear / Couple Matching Outfits / Wedding Dresses / Prom Dresses / Hats
  CLOTHING (kids/baby)    Newborn Baby Clothes / Blankets / Beds, Kids Clothing, Kids Leather Garments
  COSPLAY                 Cosplay costumes, Cosplay Face Masks, Leather Masks (high IP risk — Marvel/DC/Disney/Star Wars/anime)
  LEATHER                 Women Leather Clothing, Women Leather Heels/Shoes, Mens Leather Bracelets/Belts, Leather Accessories
  FOOTWEAR                Women Footwear, Womens Heels, Womens/Mens Slippers
  JEWELRY                 Jewelry, Couple Matching Jewelry, Birth Flower Jewelry, Nose Rings/Pins, Mens Leather Bracelets/Belts
  ACCESSORIES             Hats, Mens/Womens Handbags, Womens Nails
  PET                     Pet Store, Pet Clothing, Pet Accessories
  HOME DECOR              Motivational Wall Frames, Home Decor, Couple Decor, Table/Desk Decor, Vase, Book Stands, Event Decor, Plush Toys
  WOODEN                  Wooden Decor, Wooden Kitchen, Wooden Shelves/Organisers, Kitchen Wooden Items
  LIGHTING                Wall Hanging Lamps
  OFFICE                  Office & Study Mats, Organiser Boxes, Jewelry/Makeup Organisers
  WATCHES                 $50-$150 Watches (high counterfeit risk — Rolex / Apple / AP)
  TUMBLERS                Tumblers (HIGH risk of buyer-personalisation wording)
  CHRISTMAS               Christmas Clothing, Event Decor (Grinch / Elf on the Shelf / Disney Christmas)
  CAR ACCESSORIES         Car Accessories (HIGH risk of branded emblems — BMW / Ford / Tesla)
  GADGETS                 Home Improvement Gadgets

When the product is obviously from one of these clusters, lead the listingApproach with the appropriate audience + occasion language. Examples:
  - Plush Toy that hits Pokemon IP → "Frame as a generic cute cartoon plush for nursery decor / gifts"
  - Christmas costume that hits Grinch IP → "Frame as a green fuzzy character costume for Christmas parties"
  - Car accessory with BMW logo → "Frame as a universal-fit interior accessory; drop the emblem from photos"
  - Tumbler with 'personalised' wording → "Reframe as a fixed-design boho tumbler; remove all personalisation promises"

Your job: when an AliExpress product has policy flags, produce STRATEGIC GUIDANCE that tells the team HOW to write a safe Etsy listing for this product. You DO NOT write the actual title, tags, or description — you give the rules and direction the team will follow when they write the content themselves.

ETSY'S FOUR POLICIES — full context:

1. PROHIBITED ITEMS POLICY
   Banned outright: firearms, ammunition, drugs/CBD/THC, hate symbols, sex toys, lifesaving/medical PPE, ivory + endangered species, terrorism support, hardcore adult content.
   These cannot be reframed — you should NEVER be asked to reframe these (the rule engine gates them).

2. IP / TRADEMARK POLICY
   Etsy removes listings containing:
     - Brand names (Nike, Apple, Marvel, Disney, Gucci, etc.)
     - Character names (Deadpool, Mickey Mouse, Pikachu, Mario, etc.)
     - Studio / franchise names (Marvel, DC, Pixar, Star Wars)
     - Explicit replica language ("1:1 copy", "AAA replica", "inspired by [brand]")
   Etsy's enforcement is mostly keyword-based for these. If the team strips the IP keyword from title/tags/description, the listing passes automated scans. Photo-based DMCA remains a separate risk handled by the team's photo regen pass.

3. PPE / LIFESAVING POLICY (effective 21 July 2025)
   Banned: medical-grade masks (N95/KN95/surgical), respirators, hard hats, safety harnesses, life jackets, fire extinguishers, smoke detectors. Cloth fashion masks remain allowed.

4. CREATIVITY STANDARDS
   Every listing must be Made, Designed, Handpicked, or Sourced by the seller. Bulk-pack wording ("100pcs", "wholesale", "OEM", "factory direct") signals reseller commodity and risks removal under the Made by a Seller clause. The team should position the product as Designed or Handpicked by their shop.

REFRAME PRINCIPLES:
   - Strip IP / brand / character names entirely. Direct the team toward descriptive equivalents based on what the product IS.
   - Strip wholesale / commodity tells. Direct the team to frame as designed / curated / handpicked / boutique.
   - Strip combat terminology if the product is a costume / kitchen / decorative item. Direct the team to use the actual product role instead.
   - Etsy buyers search differently than AliExpress sellers: descriptive aesthetic + occasion + audience beats keyword stuffing.
   - Etsy title limit: 140 chars. Tag limit: 20 chars each, 13 tags max.

OUTPUT — strict JSON, no prose. Strategy and rules ONLY. Do NOT write example titles or example tags. Speak in instructions / directions / rules:

{
  "listingApproach": "One paragraph (≤350 chars) explaining the overall direction. What kind of product should the team frame this AS on Etsy? What audience, occasion, aesthetic should they lead with? What category of Etsy buyer is this listing for?",

  "titleGuidance": [
    "Short imperative bullet about what to do in the title",
    "Another rule for the title",
    "..."
  ],

  "tagGuidance": [
    "Short imperative bullet about what kinds of tags to use",
    "Another rule for tags",
    "..."
  ],

  "descriptionGuidance": [
    "Short imperative bullet about how to frame the description",
    "Another rule for the description",
    "..."
  ],

  "avoidWords": [
    "exact word 1",
    "exact phrase 2",
    "..."
  ],

  "photoGuidance": {
    "dont": [
      "Specific visual element the team should NOT recreate in their identity-shot regen",
      "..."
    ],
    "do": [
      "Specific safer alternative for the regen pass",
      "..."
    ]
  }
}

Rules:
- listingApproach is ONE paragraph, ≤350 chars. Tell the team what direction to go in — what to frame the product AS.
- titleGuidance, tagGuidance, descriptionGuidance are each 3-5 short imperative bullets. Bullets are RULES, not examples.
  GOOD bullet: "Lead with audience and occasion — drop all franchise references."
  BAD bullet:  "Use 'Red Anti-Hero Costume Kids Halloween'" — do not write actual title content.
- photoGuidance.dont[] should describe visual elements specifically tied to the IP (iconic masks, signature poses, branded logos). photoGuidance.do[] should give safer alternatives.

CRITICAL — avoidWords precision (flag the right things, not too much):

  Only flag the SPECIFIC IP-bound phrase, never standalone components of it.
    ✓ "captain america" → flag the phrase
    ✗ "captain" alone → DO NOT flag (legit in "ship captain", "captain hook costume")
    ✗ "america" alone → DO NOT flag (legit in "american flag", "americana decor")

    ✓ "iron man" → flag the phrase
    ✗ "iron" alone → DO NOT flag (legit in "wrought iron decor")

    ✓ "wonder woman" → flag the phrase
    ✗ "wonder" alone, "woman" alone → DO NOT flag

  Studio / franchise names (single word) are flagged as-is:
    ✓ "marvel", "disney", "pokemon", "lego" — these ARE the IP

  Test before flagging a single word: would this word, by itself, appear in
  thousands of legitimate non-IP Etsy listings? If yes, never include it.

NEVER include in avoidWords — these are core Etsy vocabulary:

    cosplay, costume, jumpsuit, halloween, party, kids, boys, girls,
    women, men, adult, set, gift, prop, suit, dress, outfit, vintage,
    superhero, hero, anime, gaming, themed

  If a core keyword doesn't fit the SPECIFIC target audience, say so in
  titleGuidance / tagGuidance — never in avoidWords.

    ✓ titleGuidance bullet: "Lead with 'costume' rather than 'cosplay' —
      parents shopping for kids' Halloween don't search 'cosplay'."
    ✗ avoidWords entry: "cosplay" (banning a legit 4M-listing Etsy keyword
      from a product that IS a costume).

NEVER recommend in any field (these imply buyer-supplied data the team
cannot deliver, since they ship ready-stock):
    personalised, personalized, custom-made, custom-order, monogram,
    monogrammed, "with name", "your name on"
  Note: "handmade", "artisan", "hand-crafted" are ALLOWED — these are
  marketing/feature words, not buyer-data promises.

For titleGuidance / tagGuidance specifically:
  - DO instruct on which audience-appropriate keywords to LEAD with
  - DO tell the team to drop the franchise / character / brand name
  - DO NOT tell the team to drop the physical product type (jumpsuit,
    dress, mug, jewellery, etc. are what the product IS — accurate
    descriptions rank better than vague alternatives)
  - DO NOT blanket-ban core Etsy vocab even when the source AE title used it

EXAMPLE — for a Captain America kids' costume:

  GOOD avoidWords (~10-12 entries — IP phrases + commodity tells only):
    ["captain america", "marvel", "avengers", "replica", "inspired by",
     "1:1", "aaa", "wholesale", "factory direct", "100pcs", "oem", "bulk"]

  BAD avoidWords (do NOT produce these):
    ✗ "captain"   (common word, legit in non-IP listings)
    ✗ "america"   (common word, "american-made", "vintage america")
    ✗ "cosplay"   (4M+ legit Etsy listings)
    ✗ "jumpsuit"  (the actual product type)
    ✗ "superhero" (generic role, not IP)
    ✗ "kids"      (audience keyword)

  GOOD titleGuidance:
    - Drop "Captain America" entirely; use a role-based descriptor like
      "patriotic superhero" or "star-shield hero"
    - Lead with audience + occasion: "Kids Halloween Costume",
      "Boys Dress-Up Outfit"
    - Keep the physical product type (jumpsuit, costume, suit) — accurate
      descriptions rank better
    - Stay under 140 characters

  BAD titleGuidance (do NOT produce):
    ✗ "Avoid 'cosplay' and 'jumpsuit'" (banning legit Etsy vocab)
    ✗ "Don't use the word 'superhero'" (generic role, not IP)`;

// ─── Image fetching for vision pass ──────────────────────────────────

interface FetchedImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

// Anthropic API supported image formats. AVIF and HEIC are NOT
// supported — alicdn.com serves AVIF for some products, so we must
// explicitly detect and skip those rather than lying about the MIME
// type and crashing the whole reframe call.
const SUPPORTED_IMAGE_TYPES: Array<FetchedImage["mediaType"]> = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/**
 * Fetch an AE image URL and convert to a base64 payload Anthropic
 * can ingest. Failures resolve to null — the reframe still runs in
 * text-only mode if the image can't be loaded.
 *
 * Two ways the fetch can return null:
 *   - HTTP failure / timeout / oversized
 *   - Unsupported MIME (AVIF / HEIC / TIFF) — Anthropic rejects these.
 *     We detect and skip rather than mis-labeling the bytes as JPEG,
 *     which would crash the Anthropic call and silently lose vision.
 */
async function fetchImageForVision(
  imageUrl: string,
): Promise<FetchedImage | null> {
  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;

    const contentType = (
      res.headers.get("content-type") ?? "image/jpeg"
    ).toLowerCase();

    // Reject unsupported formats before downloading the bytes — the
    // Anthropic call would reject them and crash the reframe.
    if (
      contentType.includes("avif") ||
      contentType.includes("heic") ||
      contentType.includes("heif") ||
      contentType.includes("tiff")
    ) {
      console.warn(
        `[reframe] image format ${contentType} not supported by Anthropic — skipping vision`,
      );
      return null;
    }

    const mediaType: FetchedImage["mediaType"] = contentType.includes("png")
      ? "image/png"
      : contentType.includes("webp")
        ? "image/webp"
        : contentType.includes("gif")
          ? "image/gif"
          : "image/jpeg";

    if (!SUPPORTED_IMAGE_TYPES.includes(mediaType)) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2_500_000) return null;

    return {
      base64: buf.toString("base64"),
      mediaType,
    };
  } catch (err) {
    console.warn(
      "[reframe] image fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─── Cost calc ───────────────────────────────────────────────────────

const HAIKU_INPUT_PER_M = 1; // USD / M input tokens
const HAIKU_OUTPUT_PER_M = 5; // USD / M output tokens

function calcCost(msg: Anthropic.Message): number {
  const input = msg.usage.input_tokens ?? 0;
  const output = msg.usage.output_tokens ?? 0;
  return (input * HAIKU_INPUT_PER_M + output * HAIKU_OUTPUT_PER_M) / 1_000_000;
}

// ─── Main entry point ───────────────────────────────────────────────

export interface ReframeInput {
  title: string;
  flags: ValidationFlag[];
  /** AE thumbnail URL (URL check) — fetched server-side for vision. */
  imageUrl?: string;
  /** Pre-encoded base64 images (Manual check). */
  manualImages?: FetchedImage[];
}

/**
 * Generate an Etsy-safe reframe for a flagged product.
 *
 * One Haiku call. Vision attempted if an image is available — falls
 * back gracefully to text-only if the fetch / parse fails.
 */
export async function reframeForEtsy(
  input: ReframeInput,
): Promise<ReframeResult> {
  // Collect image payloads (URL → fetch, manual → already encoded)
  const images: FetchedImage[] = [];
  if (input.imageUrl) {
    const fetched = await fetchImageForVision(input.imageUrl);
    if (fetched) images.push(fetched);
  }
  if (input.manualImages?.length) {
    images.push(...input.manualImages);
  }

  // Build the flag context for the prompt
  const flagContext =
    input.flags.length === 0
      ? "No specific keyword flags fired — generate a generally Etsy-safe listing for this product."
      : input.flags
          .map(
            (f) =>
              `- ${f.label} (${f.policyClause}): matched "${f.matchedText}". ${f.explanation}`,
          )
          .join("\n");

  const userText = `AliExpress product title:
${input.title}

Policy flags raised by the rule engine:
${flagContext}

Generate the Etsy-safe listing strategy as strict JSON per the schema.`;

  // Build content blocks (images first, then text — Anthropic best practice)
  const content: Anthropic.Messages.ContentBlockParam[] = [
    ...images.map(
      (img): Anthropic.Messages.ContentBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.base64,
        },
      }),
    ),
    { type: "text", text: userText },
  ];

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.2, // strategy / guidance — keep deterministic
    system: ETSY_POLICIES_SYSTEM,
    messages: [
      { role: "user", content },
      // Force JSON via prefilled "{"
      { role: "assistant", content: "{" },
    ],
  });

  const raw = "{" + extractText(msg);
  const parsed = parseReframe(raw);
  const cost = calcCost(msg);

  return {
    listingApproach: parsed.listingApproach,
    titleGuidance: parsed.titleGuidance,
    tagGuidance: parsed.tagGuidance,
    descriptionGuidance: parsed.descriptionGuidance,
    avoidWords: parsed.avoidWords,
    photoGuidance: parsed.photoGuidance,
    visionUsed: images.length > 0,
    modelId: MODEL,
    costUsd: cost,
  };
}

// ─── JSON parsing + normalization ────────────────────────────────────

interface ParsedReframe {
  listingApproach: string;
  titleGuidance: string[];
  tagGuidance: string[];
  descriptionGuidance: string[];
  avoidWords: string[];
  photoGuidance: PhotoRiskNote;
}

/**
 * Pull a normalised list of short instruction bullets from a JSON
 * field. Each entry is trimmed, capped to 200 chars, and the array
 * itself capped to 8 entries — enough for thorough guidance, few
 * enough that the UI doesn't drown in bullets.
 */
function parseBulletList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .slice(0, 8)
    .map((s) => s.trim().slice(0, 200));
}

function parseReframe(raw: string): ParsedReframe {
  const trimmed = raw.trim();
  const lastBrace = trimmed.lastIndexOf("}");
  const candidate = lastBrace >= 0 ? trimmed.slice(0, lastBrace + 1) : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(
      `Reframe returned non-JSON. First 200 chars: ${trimmed.slice(0, 200)}`,
    );
  }

  const obj = parsed as Record<string, unknown>;

  const listingApproach =
    typeof obj.listingApproach === "string"
      ? obj.listingApproach.trim().slice(0, 500)
      : "";

  const titleGuidance = parseBulletList(obj.titleGuidance);
  const tagGuidance = parseBulletList(obj.tagGuidance);
  const descriptionGuidance = parseBulletList(obj.descriptionGuidance);

  const avoidWords = Array.isArray(obj.avoidWords)
    ? obj.avoidWords
        .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
        .map((w) => w.trim().slice(0, 60))
        .slice(0, 30)
    : [];

  let photoGuidance: PhotoRiskNote = { dont: [], do: [] };
  const pg = obj.photoGuidance as Record<string, unknown> | undefined;
  if (pg && typeof pg === "object") {
    photoGuidance = {
      dont: parseBulletList(pg.dont),
      do: parseBulletList(pg.do),
    };
  }

  return {
    listingApproach,
    titleGuidance,
    tagGuidance,
    descriptionGuidance,
    avoidWords,
    photoGuidance,
  };
}

function extractText(msg: Anthropic.Message): string {
  return msg.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

export type { FetchedImage };
