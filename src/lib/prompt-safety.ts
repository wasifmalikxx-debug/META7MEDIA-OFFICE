/**
 * L7 — prompt-injection hardening for untrusted text that gets interpolated
 * into an LLM prompt (SEO Autopilot titles/specs, tag-swap inputs, niche hunt,
 * Higgsfield prompt brief).
 *
 * Design goal: be a NO-OP for legitimate product text. A normal product title,
 * spec sheet or niche string passes through byte-for-byte unchanged, so there
 * is zero output drift for real listings. We only touch characters / patterns
 * that have no business in product copy but are used to hijack the model:
 *   - control / zero-width / bidi characters (smuggle hidden instructions)
 *   - conversation-turn markers at line starts ("Human:" / "Assistant:" /
 *     "System:" / "User:") used to fake a new turn
 *   - newline floods used to push real instructions out of view
 *
 * This deliberately does NOT restructure the prompts (no delimiter wrapping,
 * no system-prompt edits) — that keeps the calibrated generation behaviour
 * identical for every benign input.
 */

// True for chars that should be removed: C0 control + DEL (except tab=9,
// newline=10), and zero-width / bidi-override chars used to hide text.
function isStripChar(code: number): boolean {
  if (code === 9 || code === 10) return false; // keep tab + newline
  if (code <= 31) return true; // other C0 controls
  if (code === 127) return true; // DEL
  if (code >= 0x200b && code <= 0x200f) return true; // zero-width family
  if (code >= 0x202a && code <= 0x202e) return true; // bidi overrides
  if (code === 0x2060) return true; // word joiner
  if (code === 0xfeff) return true; // BOM / zero-width no-break space
  return false;
}

export function sanitizePromptInput(value: unknown, maxLen = 4000): string {
  let s = typeof value === "string" ? value : value == null ? "" : String(value);

  // 1. Strip control / zero-width / bidi characters (keeping tab + newline).
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (!isStripChar(s.charCodeAt(i))) out += s[i];
  }
  s = out;

  // 2. Defang conversation-turn markers ONLY at the real injection frame: the
  //    very start of the input, or after a BLANK line (\n\n) — i.e. where a
  //    role keyword tries to simulate a new turn boundary. The keyword is
  //    preserved; only the "Role:" colon is swapped for " -".
  //    Anchoring on a blank line (not any newline) means ordinary multi-line
  //    spec lists like "Material: x\nSystem: Android" are left untouched — zero
  //    drift for real product copy — while "...text\n\nHuman: do X" is caught.
  s = s.replace(/(^|\n[ \t]*\n)[ \t]*(human|assistant|system|user)[ \t]*:/gi, "$1$2 -");

  // 3. Collapse newline floods (3+ consecutive -> 2). Legit specs don't need
  //    more than a blank line.
  s = s.replace(/\n{3,}/g, "\n\n");

  // 4. Trim + hard length cap (defence in depth; schemas also cap upstream).
  return s.trim().slice(0, maxLen);
}

/**
 * zod `.transform()` helper for OPTIONAL / NULLABLE string fields: passes
 * null/undefined through untouched (so `value ?? undefined` semantics are
 * preserved downstream) and sanitizes only real strings.
 */
export function sanitizeMaybePromptInput<T>(value: T, maxLen = 4000): T {
  return typeof value === "string" ? (sanitizePromptInput(value, maxLen) as unknown as T) : value;
}
