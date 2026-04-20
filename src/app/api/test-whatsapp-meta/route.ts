import { NextRequest } from "next/server";
import { json, error, requireRole } from "@/lib/api-helpers";
import { sendMetaTemplate, sendMetaText, isMetaEnabled } from "@/lib/services/whatsapp-meta.service";

/**
 * CEO-only WhatsApp Meta API test endpoint.
 *
 * GET /api/test-whatsapp-meta            → reports config status
 * POST /api/test-whatsapp-meta           → sends a test template message
 *   body: {
 *     to: "923001234567",                // required — must be an approved recipient on the test number
 *     template: "late_fine",             // Meta template name (must be approved)
 *     variables: ["Wasif", "15", "100"], // positional {{1}}, {{2}}, {{3}}
 *     language: "en",                    // optional, defaults to "en"
 *     text: "Hello world"                // OR send a plain-text message (only within 24h session window)
 *   }
 *
 * This hits Meta Graph API directly, bypassing Twilio entirely. Use it to:
 *  1. Confirm your token + phone ID + approved templates work
 *  2. Debug template rejections (Meta returns the exact error reason)
 *  3. Verify before flipping the global META_WA_ENABLED flag
 */

export async function GET() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden — CEO only", 403);

  return json({
    metaEnabled: isMetaEnabled(),
    hasToken: !!process.env.META_WA_TOKEN,
    hasPhoneId: !!process.env.META_WA_PHONE_NUMBER_ID,
    featureFlag: process.env.META_WA_ENABLED || "(not set)",
    hint: "POST to this endpoint with { to, template, variables } to send a test.",
  });
}

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden — CEO only", 403);

  try {
    const body = await request.json();
    const { to, template, variables, language, text } = body || {};

    if (!to || typeof to !== "string") {
      return error("Missing 'to' (phone number) in body", 400);
    }

    // Plain text path (will fail outside 24h session window — expected)
    if (text) {
      const result = await sendMetaText(to, String(text));
      return json({ mode: "text", ...result });
    }

    // Template path (what the app actually uses)
    if (!template) {
      return error("Missing 'template' name (e.g. 'late_fine')", 400);
    }

    const vars: string[] = Array.isArray(variables)
      ? variables.map((v) => String(v))
      : [];

    const result = await sendMetaTemplate(to, String(template), vars, language || "en");
    return json({ mode: "template", template, variables: vars, ...result });
  } catch (err: any) {
    return error(err.message || "Invalid request body", 500);
  }
}
