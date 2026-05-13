/**
 * Anthropic Claude client for SEO Autopilot.
 *
 * Two-stage generation:
 *   1. SONNET writes the listing (title, 13 tags, description, materials,
 *      style/occasion/recipient — using the live competitor data we
 *      gathered from Etsy as context).
 *   2. HAIKU validates compliance (banned terms, trademark risk, character
 *      limits, tag duplicates).
 *
 * Output is forced into strict JSON via Anthropic's "prefill the response
 * with `{`" trick + a schema-shaped system prompt. We then JSON.parse and
 * normalize. Streaming is OFF for v1 — we want the full validated object,
 * not partial UI flicker.
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
const MODEL_VALIDATOR = "claude-haiku-4-5-20251001";

// ─── Etsy listing rules — the source of truth for output validation ──

export const ETSY_LIMITS = {
  TITLE_MAX: 140,
  TAG_MAX_CHARS: 20,
  TAG_COUNT: 13,
  DESCRIPTION_MAX: 5000,
  MATERIALS_MAX: 13,
} as const;

// ─── Input shape ──────────────────────────────────────────────────────

export interface GenerationInput {
  /** What the seller is making/selling. 1-2 sentences (or the AliExpress title). */
  productBrief: string;
  /** Reference title (e.g. from AliExpress source). Optional. */
  referenceTitle?: string;
  /** Confirmed Etsy taxonomy node we're targeting. */
  category: {
    id: number;
    name: string;
    path: string;
  };
  /** Live ranking-1..20 competitors for our keyword. */
  competitors: CompetitorBrief[];
  /** Required + optional attribute slots for this category. */
  attributeSchema: {
    name: string;
    displayName: string;
    required: boolean;
    possibleValues: string[];
  }[];
  /** Optional flavour notes — "father's day gift", "minimalist", etc. */
  audience?: string;
  style?: string;
  /** Matured shop tone or new shop (slightly more discount-forward). */
  shopMaturity?: "matured" | "new";
}

// ─── Stage 0 — Context extraction (Haiku) ─────────────────────────────

/**
 * Given a raw AliExpress / source title (which is keyword-stuffed and
 * noisy), extract the cleanest search-intent keyword + product type so
 * we can drive the Etsy search ourselves. This removes the user-facing
 * "pick a keyword + category" step.
 */
export interface ExtractedContext {
  /** Best 2-5 word keyword a real Etsy buyer would type. */
  searchKeyword: string;
  /** 1-3 word product-type label (matches Etsy taxonomy node language). */
  productType: string;
  /** Likely target audience inferred from the title — used as a soft hint. */
  audienceHint: string;
  /** Style/aesthetic inferred from the title — used as a soft hint. */
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
- productType MUST match how Etsy categorises things (singular OK if Etsy uses singular, plural OK if plural). When unsure pick the most common form.
- Never invent details not present in the title.`;

export async function extractSearchContext(
  rawTitle: string,
  notes?: string,
): Promise<ExtractedContext> {
  const userPrompt = notes && notes.trim()
    ? `AliExpress / source title:\n${rawTitle}\n\nExtra notes from the seller:\n${notes}`
    : `AliExpress / source title:\n${rawTitle}`;

  const msg = await client().messages.create({
    model: MODEL_VALIDATOR, // Haiku — fast + cheap, classification not generation
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

  // Trim + clamp to reasonable lengths.
  return {
    searchKeyword: (parsed.searchKeyword ?? "").trim().slice(0, 80),
    productType: (parsed.productType ?? "").trim().slice(0, 40),
    audienceHint: (parsed.audienceHint ?? "").trim().slice(0, 80),
    styleHint: (parsed.styleHint ?? "").trim().slice(0, 80),
  };
}

// ─── Output shape (mirrors what we ship to the UI) ────────────────────

export interface GeneratedListing {
  title: string;
  tags: string[]; // exactly 13
  description: string;
  materials: string[]; // up to 13
  attributes: { name: string; value: string }[]; // pre-filled category slots
  altText: string; // primary image alt text
  rationale: {
    keywordFocus: string;
    titleStrategy: string;
    audienceHook: string;
  };
}

export interface ComplianceReport {
  ok: boolean;
  issues: { severity: "warn" | "block"; field: string; message: string }[];
}

// ─── Stage 1 — Generation ─────────────────────────────────────────────

const GENERATOR_SYSTEM = `You are an elite Etsy SEO copywriter at META7MEDIA. You ONLY produce listing copy that:

1. NEVER copies a competitor's title/tags/description verbatim — produce ORIGINAL English copy that captures the same intent.
2. Follows every Etsy rule:
   • Title ≤ 140 characters total
   • Exactly 13 tags, each ≤ 20 characters, lowercase, single-word and multi-word phrases both fine
   • No tag duplicates and no near-duplicates (don't ship both "leather wallet" and "leather wallets")
   • No banned/trademarked terms (Disney, Nike, Marvel, official sport team names, etc.)
3. Front-loads the most-searched keyword. Etsy weighs early-title words higher.
4. Uses "|" or "•" separators in the title, never commas (commas split phrases in Etsy's matcher).
5. Writes a description in 3 sections:
   — Hook (1-2 lines, benefit-led)
   — Features (bullet list of 4-7 specific attributes)
   — Care / sizing / shipping note (1 short paragraph)
6. Fills category-required attributes with realistic values from the supplied possible-values list. If a value isn't in the list, omit that attribute.

OUTPUT FORMAT — strict JSON, no prose before or after, no markdown fences:
{
  "title": "...",
  "tags": ["...", "...", ... 13 items],
  "description": "...",
  "materials": ["...", "..."],
  "attributes": [{"name": "...", "value": "..."}],
  "altText": "...",
  "rationale": {
    "keywordFocus": "1 line — the primary keyword and why",
    "titleStrategy": "1 line — what the title does for ranking",
    "audienceHook": "1 line — who this targets and what triggers their click"
  }
}`;

function buildUserPrompt(input: GenerationInput): string {
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

  return `# Product brief
${input.productBrief}

${input.referenceTitle ? `Reference (AliExpress / source) title: ${input.referenceTitle}\n` : ""}

# Target Etsy category
${input.category.path}  (taxonomy_id: ${input.category.id})

# Audience / style hints
${input.audience ? `Audience: ${input.audience}` : "Audience: (not specified — infer from the brief)"}
${input.style ? `Style: ${input.style}` : "Style: (not specified)"}
Shop maturity: ${input.shopMaturity === "new" ? "new shop — slightly more discount/value-forward tone" : "matured shop — confidence tone"}

# Live Etsy ranking data — top 20 for this keyword space
Use these as competitive intelligence ONLY. Identify the recurring keywords. Write an ORIGINAL listing that targets the same buyer better than any of them. Do NOT copy phrasing.

${competitorBlock || "(no competitor data — generate based on the brief alone)"}

# Category attribute schema
Fill the slots below using realistic values. Use ONLY values from the possible-values list when one is provided. Skip slots you cannot confidently fill.

${attributeBlock || "(no defined attributes for this category — return an empty attributes array)"}

Now produce the listing JSON.`;
}

export async function generateListing(
  input: GenerationInput,
): Promise<GeneratedListing> {
  const msg = await client().messages.create({
    model: MODEL_GENERATOR,
    max_tokens: 2400,
    temperature: 0.65,
    system: GENERATOR_SYSTEM,
    messages: [
      { role: "user", content: buildUserPrompt(input) },
      // Prefill `{` so Sonnet must continue JSON, not narrate.
      { role: "assistant", content: "{" },
    ],
  });

  // Reconstruct the full JSON by adding back the prefill character.
  const raw = "{" + extractText(msg);
  const parsed = safeParseJson<GeneratedListing>(raw);

  return normalize(parsed);
}

// ─── Stage 2 — Compliance ─────────────────────────────────────────────

const VALIDATOR_SYSTEM = `You are an Etsy compliance auditor. Given a listing draft, check for:

1. TRADEMARK / IP — flag specific brand names (Disney, Marvel, Nike, NFL/NBA/MLB team names, copyrighted characters, Pokemon, etc.). Generic words like "vintage" or "minimalist" are fine.
2. PROHIBITED CONTENT — weapons, drugs, regulated wellness claims, adult content where category doesn't allow it.
3. RULES — title >140 chars, tag >20 chars, tag count != 13, duplicate tags, description >5000 chars.
4. REDUNDANCY — tag duplicates near-duplicates (singular/plural pairs are wasted slots).

OUTPUT — strict JSON only:
{
  "ok": boolean,                     // true if no "block" severity issues
  "issues": [
    {"severity": "warn"|"block", "field": "title"|"tags"|"description"|"attributes", "message": "..."}
  ]
}

Mark severity "block" only for things that would get the listing taken down or auto-rejected. Mark "warn" for redundancy / suboptimal but legal.`;

export async function validateListing(
  listing: GeneratedListing,
): Promise<ComplianceReport> {
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
  const parsed = safeParseJson<ComplianceReport>(raw);
  // Belt-and-suspenders: if Haiku says ok=true but we detect a hard rule
  // break locally, escalate to ok=false.
  const localIssues = localRuleCheck(listing);
  const merged: ComplianceReport = {
    ok: parsed.ok && localIssues.every((i) => i.severity !== "block"),
    issues: [...(parsed.issues ?? []), ...localIssues],
  };
  return merged;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractText(msg: Anthropic.Message): string {
  // Filter the content blocks to text-only and concatenate. We only call
  // messages.create() without `stream: true`, so the return is always a
  // Message (never a Stream), but TS's overload union needs the narrow.
  return msg.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

function safeParseJson<T>(raw: string): T {
  // The model occasionally appends trailing prose. Cut at the last `}`.
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

function normalize(out: GeneratedListing): GeneratedListing {
  // Guard against subtle model drift — clamp every field to spec.
  const title = (out.title ?? "").trim().slice(0, ETSY_LIMITS.TITLE_MAX);

  // Tags: lowercase, trim, dedupe, clamp length, pad/truncate to 13.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of out.tags ?? []) {
    const t = (raw ?? "").toString().trim().toLowerCase().slice(0, ETSY_LIMITS.TAG_MAX_CHARS);
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

  const altText = (out.altText ?? "").toString().trim().slice(0, 250);

  const rationale = {
    keywordFocus: (out.rationale?.keywordFocus ?? "").toString(),
    titleStrategy: (out.rationale?.titleStrategy ?? "").toString(),
    audienceHook: (out.rationale?.audienceHook ?? "").toString(),
  };

  return { title, tags, description, materials, attributes, altText, rationale };
}

function localRuleCheck(l: GeneratedListing): ComplianceReport["issues"] {
  const issues: ComplianceReport["issues"] = [];
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
