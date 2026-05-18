/**
 * Product Validator — AI reframe pipeline.
 *
 * When the rule engine returns REVIEW (soft-flag — IP, brand,
 * Creativity Standards, or combat-terminology in costume context),
 * this service calls Claude Haiku 4.5 with the four Etsy policies
 * as system context and asks it to produce an Etsy-safe listing
 * strategy:
 *
 *   - 3 candidate titles (the seller picks one)
 *   - 13 Etsy-safe tags
 *   - 1-paragraph description angle
 *   - Explicit "avoid these exact words" list
 *   - Photo regeneration guidance (what NOT to recreate in the
 *     identity-shot pass the team does before listing)
 *
 * The team always regenerates photos before listing, so this output
 * is for the textual side + a coaching note on photo regen.
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
  /** 3 candidate Etsy-safe titles ordered best-first. */
  titles: string[];
  /** 13 Etsy-safe tags, ≤20 chars each. */
  tags: string[];
  /** 1-paragraph description angle (creativity-standards compliant). */
  descriptionAngle: string;
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

const ETSY_POLICIES_SYSTEM = `You are an Etsy compliance specialist for a dropshipping team in Pakistan.
The team sources products from AliExpress, regenerates all product photos with new identity shots before listing, and lists on Etsy.

Your job: when an AliExpress product has policy flags, generate an Etsy-safe listing strategy that will pass Etsy's automated keyword scans and minimise DMCA risk.

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
   Etsy's enforcement is mostly keyword-based for these. Strip the IP keyword from title/tags/description and the listing passes automated scans. Photo-based DMCA remains a separate risk handled by the team's photo regen pass.

3. PPE / LIFESAVING POLICY (effective 21 July 2025)
   Banned: medical-grade masks (N95/KN95/surgical), respirators, hard hats, safety harnesses, life jackets, fire extinguishers, smoke detectors. Cloth fashion masks remain allowed.

4. CREATIVITY STANDARDS
   Every listing must be Made, Designed, Handpicked, or Sourced by the seller. Bulk-pack wording ("100pcs", "wholesale", "OEM", "factory direct") signals reseller commodity and risks removal under the Made by a Seller clause. The reframe should position the product as Designed or Handpicked by the shop.

REFRAME PRINCIPLES:
   - Strip IP / brand / character names entirely. Replace with descriptive equivalents based on what the product IS (red anti-hero costume, athletic sneakers, cute cartoon plush).
   - Strip wholesale / commodity tells. Frame as "designed", "curated", "handpicked", "boutique".
   - Strip combat terminology if the product is a costume / kitchen / decorative item. Use the actual product role instead.
   - Etsy buyers search differently than AliExpress sellers: descriptive aesthetic + occasion + audience beats keyword stuffing.
   - Each title MUST be under 140 characters.
   - Each tag MUST be under 20 characters. Lowercase, multi-word tags allowed.

OUTPUT — strict JSON, no prose:
{
  "titles": ["title 1", "title 2", "title 3"],
  "tags": ["tag1", "tag2", ..., "tag13"],
  "descriptionAngle": "one paragraph (≤300 chars) explaining how the seller should frame the description — what to emphasise, what role the product plays, what occasion it fits.",
  "avoidWords": ["exact word 1", "exact phrase 2", ...],
  "photoGuidance": {
    "dont": ["specific thing the team should NOT recreate in the regenerated identity photos", ...],
    "do": ["specific safer alternative for the photo regen pass", ...]
  }
}

Rules:
- titles[] must be 3 distinct angles (e.g. occasion-led, audience-led, style-led). All ≤140 chars. None may contain any flagged keyword.
- tags[] must be exactly 13 entries. Each ≤20 chars. None may contain any flagged keyword.
- avoidWords[] should be the exact strings the seller must not include — be specific (e.g. "deadpool", "wade wilson", "marvel", not generic guidance).
- photoGuidance.dont[] should describe visual elements specifically tied to the IP (iconic masks, signature poses, branded logos). photoGuidance.do[] should give safer alternatives.
- Never use the words: handmade, personalised, custom-made, monogram (those imply buyer-supplied data which we cannot deliver).`;

// ─── Image fetching for vision pass ──────────────────────────────────

interface FetchedImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

/**
 * Fetch an AE image URL and convert to a base64 payload Anthropic
 * can ingest. Failures resolve to null — the reframe still runs in
 * text-only mode if the image can't be loaded.
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
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const mediaType: FetchedImage["mediaType"] = contentType.includes("png")
      ? "image/png"
      : contentType.includes("webp")
        ? "image/webp"
        : contentType.includes("gif")
          ? "image/gif"
          : "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    // Cap at ~2MB raw to stay well inside Anthropic's request limit.
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
    temperature: 0.3, // small creativity for title variety, low overall
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
    titles: parsed.titles,
    tags: parsed.tags,
    descriptionAngle: parsed.descriptionAngle,
    avoidWords: parsed.avoidWords,
    photoGuidance: parsed.photoGuidance,
    visionUsed: images.length > 0,
    modelId: MODEL,
    costUsd: cost,
  };
}

// ─── JSON parsing + normalization ────────────────────────────────────

interface ParsedReframe {
  titles: string[];
  tags: string[];
  descriptionAngle: string;
  avoidWords: string[];
  photoGuidance: PhotoRiskNote;
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

  // Normalise — Haiku occasionally returns fewer than 3 titles or
  // fewer than 13 tags; clamp + pad rather than failing the whole
  // pipeline.
  const titles = Array.isArray(obj.titles)
    ? obj.titles
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .slice(0, 3)
        .map((t) => t.trim().slice(0, 140))
    : [];

  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .slice(0, 13)
        .map((t) => t.trim().toLowerCase().slice(0, 20))
    : [];

  const descriptionAngle =
    typeof obj.descriptionAngle === "string"
      ? obj.descriptionAngle.trim().slice(0, 400)
      : "";

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
      dont: Array.isArray(pg.dont)
        ? pg.dont
            .filter(
              (s): s is string =>
                typeof s === "string" && s.trim().length > 0,
            )
            .slice(0, 8)
            .map((s) => s.trim().slice(0, 200))
        : [],
      do: Array.isArray(pg.do)
        ? pg.do
            .filter(
              (s): s is string =>
                typeof s === "string" && s.trim().length > 0,
            )
            .slice(0, 8)
            .map((s) => s.trim().slice(0, 200))
        : [],
    };
  }

  return {
    titles,
    tags,
    descriptionAngle,
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
