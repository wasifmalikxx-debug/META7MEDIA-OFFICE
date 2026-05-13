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
import type { CompetitorBrief } from "./etsy-api.service";

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

const COMPLIANCE_SYSTEM = `You are a STRICT Etsy listing compliance officer. Looking at product images + title, decide if this product can be legally listed on Etsy without getting taken down or earning a shop strike.

Be conservative — when in doubt, lean BLOCKED. A single trademark slip costs the seller their entire shop. Better to flag a borderline case than miss a real violation.

BLOCKED categories (ANY ONE of these = automatic BLOCK):
• TRADEMARK / COPYRIGHT visible on the product itself:
  - Disney characters (Mickey, Frozen, Star Wars, Marvel, etc.)
  - Nintendo / Pokemon / Pikachu / video game characters
  - Sports team logos / names (NFL, NBA, MLB, NHL, FIFA)
  - Branded fonts / logos (Nike swoosh, Adidas stripes, Apple logo)
  - Copyrighted artwork or character designs
  - College / university logos
• COUNTERFEIT / REPLICA:
  - Designer brand copies (fake Gucci, Louis Vuitton, Rolex, Cartier, etc.)
  - "Inspired by" goods that closely mimic a brand
• PROHIBITED ITEMS per Etsy:
  - Weapons (firearms, ammunition, switchblades, brass knuckles)
  - Drug paraphernalia, regulated wellness (CBD/THC without paperwork)
  - Hazardous materials (chemicals, certain magnets, asbestos)
  - Currency, financial instruments, lottery tickets, gift cards
  - Live animals, human remains
  - Recalled goods, stolen items
  - Medical devices requiring FDA clearance
• ADULT CONTENT in non-adult categories.

REVIEW (warn but allow):
• Borderline "inspired by" wording (parody designs without direct logo copying)
• Quality concerns (visibly low-resolution or unprofessional photos)
• Vague trademark proximity (generic Mickey Mouse-ish ears without direct character)

ALLOWED:
• Clean, non-branded product photos
• Generic designs without IP
• Standard categories Etsy accepts (handmade, vintage, craft supplies)

OUTPUT FORMAT — strict JSON, no prose before/after, no markdown fences:
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

If verdict is ALLOWED, "concerns" can be an empty array. If BLOCKED, every blocking concern MUST have severity "block".`;

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
    system: COMPLIANCE_SYSTEM,
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

const GENERATOR_SYSTEM = `You are an elite Etsy SEO copywriter at META7MEDIA. You see product images + title + live ranking-listing data, and you produce a complete, original Etsy listing that ranks AND complies with Etsy rules.

CORE RULES:
1. NEVER copy a competitor's title/tags/description verbatim — produce ORIGINAL English copy that captures the same buyer intent.
2. Title ≤ 140 characters. Front-load the most-searched keyword. Use "|" or "•" separators, NEVER commas (commas split phrases in Etsy's matcher).
3. Tags: exactly 13. Each ≤ 20 chars. Lowercase. No duplicates / near-duplicates (don't ship both "leather wallet" and "leather wallets").
4. No banned/trademarked terms (Disney, Marvel, Nike, NFL/NBA/MLB, Pokemon, etc.).
5. Description in 3 sections:
   — Hook (1-2 lines, benefit-led)
   — Features (4-7 bullets of specific attributes you can see in the image)
   — Care / sizing / shipping note (1 short paragraph)
6. Fill category-required attributes using values from the supplied possible-values list. If a value isn't in the list, omit that attribute. Cover BOTH required AND optional attributes when you can confidently pick a value — more attributes = better Etsy ranking.
7. If sizes/colors were provided, REFLECT them in the description ("Available in XS-XXL and 5 colors"). Do NOT put them in tags or title — Etsy handles those as separate variation fields.
8. If hasPersonalization is true, write personalizationInstructions as the prompt buyers will see when ordering (e.g., "Please leave the name to be engraved on the band — max 12 characters, any standard letter or number.").
9. altTexts: write ONE descriptive alt text per image you see. ≤ 250 chars each. Describe what's in the image — color, material, style, key features.
10. Suggest sensible defaults for Etsy's metadata fields:
    - suggestedType: "physical" for tangible goods, "digital" for downloadables
    - suggestedWhoMadeIt: "i_did" if it looks handmade/personal, "someone_else" if mass-produced, "collective" if a small team
    - suggestedWhatIsIt: "finished_product" for ready-to-buy goods, "supply" for materials/tools
    - suggestedWhenMade: "made_to_order" for personalized/custom, "2020_2026" for current mass-produced inventory

OUTPUT FORMAT — strict JSON, no prose, no markdown fences:
{
  "title": "...",
  "description": "...",
  "tags": ["...", ... 13 items],
  "materials": ["...", "..."],
  "attributes": [{"name": "Style", "value": "Vintage"}, ...],
  "altTexts": ["...", "..."],
  "personalizationInstructions": "...",
  "suggestedType": "physical" | "digital",
  "suggestedWhoMadeIt": "i_did" | "someone_else" | "collective",
  "suggestedWhatIsIt": "finished_product" | "supply",
  "suggestedWhenMade": "made_to_order" | "2020_2026" | "2010_2019" | "2000_2009",
  "rationale": {
    "keywordFocus": "1 line — the primary keyword and why",
    "titleStrategy": "1 line — what the title does for ranking",
    "audienceHook": "1 line — who this targets and what triggers their click"
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

# Live Etsy ranking data — top 20 for "${input.competitors[0] ? "this keyword space" : "no data"}"
Use these as competitive intelligence ONLY. Identify the recurring keywords. Write an ORIGINAL listing that targets the same buyer better than any of them. Do NOT copy phrasing.

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
    system: GENERATOR_SYSTEM,
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
