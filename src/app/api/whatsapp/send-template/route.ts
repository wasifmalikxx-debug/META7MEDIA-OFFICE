import { NextResponse } from "next/server";
import { sendMetaTemplate, isMetaEnabled } from "@/lib/services/whatsapp-meta.service";

/**
 * POST /api/whatsapp/send-template
 *
 * Secure bridge so OTHER M7 apps (e.g. the Publisher app) can send an APPROVED
 * WhatsApp template through this office app's already-configured Meta number —
 * without ever holding the Meta token themselves.
 *
 * Locked down three ways:
 *   1. Requires a shared secret (Bearer PUBLISHER_BRIDGE_SECRET).
 *   2. Only templates on ALLOWED_TEMPLATES may be sent (no arbitrary messages).
 *   3. WhatsApp only delivers pre-approved templates anyway.
 *
 * Body: { to: string | string[], templateName: string, params: string[], languageCode?: string }
 */

export const runtime = "nodejs";
export const maxDuration = 60;

// Only these templates may be sent via the bridge. Add names here as needed.
const ALLOWED_TEMPLATES = new Set(["publisher_daily_report"]);

export async function POST(req: Request) {
  const secret = process.env.PUBLISHER_BRIDGE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Bridge not configured (PUBLISHER_BRIDGE_SECRET unset)" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    to?: string | string[];
    templateName?: string;
    params?: unknown[];
    languageCode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const templateName = String(body.templateName || "");
  if (!ALLOWED_TEMPLATES.has(templateName)) {
    return NextResponse.json({ error: `Template not allowed: ${templateName}` }, { status: 403 });
  }
  if (!isMetaEnabled()) {
    return NextResponse.json({ error: "Meta WhatsApp not enabled on the office app" }, { status: 503 });
  }

  const recipients = Array.isArray(body.to) ? body.to : body.to ? [body.to] : [];
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No recipients" }, { status: 400 });
  }
  const params = Array.isArray(body.params) ? body.params.map((v) => String(v)) : [];
  const lang = body.languageCode || "en";

  const results: { to: string; ok: boolean; error?: string }[] = [];
  for (const to of recipients) {
    const r = await sendMetaTemplate(String(to), templateName, params, lang);
    results.push({ to: String(to), ok: r.success, error: r.error });
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter((r) => r.ok).length,
    recipients: results.length,
    results,
  });
}
