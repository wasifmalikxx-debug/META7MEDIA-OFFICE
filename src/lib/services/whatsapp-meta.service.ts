/**
 * WhatsApp via Meta Cloud API (direct, no Twilio).
 *
 * Sends template messages to approved Meta WhatsApp Business templates.
 * Routes through graph.facebook.com/v21.0/<phoneId>/messages with a
 * Bearer access token. No SDK needed — plain fetch.
 *
 * Why direct Meta instead of Twilio: eliminates the per-message middleman
 * markup (~$0.005/msg + conversation fee), and the first 1,000 utility
 * conversations/month are free on Meta's side. Saves ~$40/mo at current
 * message volume.
 *
 * Env vars required (production):
 *   META_WA_TOKEN               — access token (permanent via System User)
 *   META_WA_PHONE_NUMBER_ID     — sender phone number ID
 *   META_WA_ENABLED             — "true" to route through Meta instead of Twilio
 *
 * The wrapper in whatsapp.service.ts checks META_WA_ENABLED and falls back
 * to Twilio if Meta is disabled, misconfigured, or a call fails.
 */

import { normalizePhone } from "@/lib/pkt";

const GRAPH_API_VERSION = "v21.0";

// Meta template names — must match exactly what's approved in WhatsApp Manager.
// These correspond 1:1 with the Twilio ContentSid map in whatsapp.service.ts.
export const META_TEMPLATE_NAMES = {
  LATE_FINE: "late_fine",
  BREAK_FINE: "break_fine",
  ABSENT_NOTICE: "absent_notice",
  MANUAL_FINE: "manual_fine",
  SALARY_PAID: "salary_paid",
  DAILY_REPORT: "daily_report",
} as const;

export interface MetaSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode?: number;
}

/**
 * True if the Meta path is fully configured AND the feature flag is on.
 * Used by callers to decide whether to try Meta (and fall back to Twilio
 * on any failure) vs. skip Meta entirely.
 */
export function isMetaEnabled(): boolean {
  return (
    process.env.META_WA_ENABLED === "true" &&
    !!process.env.META_WA_TOKEN &&
    !!process.env.META_WA_PHONE_NUMBER_ID
  );
}

/**
 * Send an approved template message via Meta Cloud API.
 *
 * @param to         Recipient phone (any format — we normalize). Must be on
 *                   the allowed-recipient list if using Meta's test number.
 * @param templateName  The exact name you used when creating the template
 *                      in WhatsApp Manager (lowercase_with_underscores).
 * @param variables  Ordered list of strings for body params {{1}}, {{2}}, ...
 *                   If the approved template has zero variables, pass [].
 * @param languageCode  Defaults to "en" — must match the approved template's
 *                      language. Most of ours are en.
 */
export async function sendMetaTemplate(
  to: string,
  templateName: string,
  variables: string[] = [],
  languageCode: string = "en"
): Promise<MetaSendResult> {
  const token = process.env.META_WA_TOKEN;
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { success: false, error: "META_WA_TOKEN or META_WA_PHONE_NUMBER_ID not set" };
  }

  const normalized = normalizePhone(to);
  if (!normalized) {
    return { success: false, error: `Invalid phone: ${to}` };
  }

  // Meta wants digits only, no leading '+', no 'whatsapp:' prefix.
  const cleanTo = normalized.replace(/^whatsapp:/, "").replace(/^\+/, "").replace(/\D/g, "");

  const body: any = {
    messaging_product: "whatsapp",
    to: cleanTo,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  };

  if (variables.length > 0) {
    body.template.components = [
      {
        type: "body",
        parameters: variables.map((v) => ({ type: "text", text: String(v) })),
      },
    ];
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Meta error shape: { error: { message, code, type, error_subcode, fbtrace_id } }
      const errMsg =
        data?.error?.message || data?.error?.error_user_msg || `HTTP ${res.status}`;
      console.error(
        `[meta-wa] template=${templateName} to=${cleanTo} FAILED status=${res.status} err="${errMsg}"`
      );
      return { success: false, error: errMsg, statusCode: res.status };
    }

    const messageId = data?.messages?.[0]?.id;
    console.log(`[meta-wa] template=${templateName} to=${cleanTo} OK messageId=${messageId}`);
    return { success: true, messageId, statusCode: res.status };
  } catch (err: any) {
    console.error(`[meta-wa] template=${templateName} to=${cleanTo} THREW:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a plain-text (non-template) message. Only works within an active
 * 24-hour conversation window — i.e. after the recipient has messaged the
 * business first, OR within 24h of the last business-initiated template.
 *
 * For all your cron-triggered notifications (fines, absences, salary),
 * you MUST use sendMetaTemplate. Plain text will fail silently outside
 * the session window.
 */
export async function sendMetaText(to: string, message: string): Promise<MetaSendResult> {
  const token = process.env.META_WA_TOKEN;
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { success: false, error: "META_WA_TOKEN or META_WA_PHONE_NUMBER_ID not set" };
  }

  const normalized = normalizePhone(to);
  if (!normalized) return { success: false, error: `Invalid phone: ${to}` };

  const cleanTo = normalized.replace(/^whatsapp:/, "").replace(/^\+/, "").replace(/\D/g, "");

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cleanTo,
          type: "text",
          text: { body: message, preview_url: false },
        }),
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg =
        data?.error?.message || data?.error?.error_user_msg || `HTTP ${res.status}`;
      return { success: false, error: errMsg, statusCode: res.status };
    }
    return { success: true, messageId: data?.messages?.[0]?.id, statusCode: res.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
