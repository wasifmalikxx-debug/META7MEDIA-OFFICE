/**
 * WhatsApp notification service — Meta Cloud API.
 *
 * Templates used: late_notice, break_fine, absent_fine, manual_fine,
 * salary_paid. All must be pre-approved in Meta WhatsApp Manager.
 *
 * Kill switch: set OfficeSettings.whatsappEnabled = false in the DB, OR set
 * META_WA_ENABLED != "true" in env. Either disables ALL WhatsApp sends.
 */

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/pkt";
import {
  isMetaEnabled,
  sendMetaTemplate,
  sendMetaText,
  META_TEMPLATE_NAMES,
} from "@/lib/services/whatsapp-meta.service";

// Cache the DB-level WhatsApp enabled flag for 60s to avoid a DB hit per
// message. OfficeSettings rarely changes.
let whatsappEnabledCache: boolean | null = null;
let whatsappCacheTime = 0;

async function isWhatsAppEnabledCached(): Promise<boolean> {
  const now = Date.now();
  if (whatsappEnabledCache !== null && now - whatsappCacheTime < 60_000) {
    return whatsappEnabledCache;
  }
  try {
    const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
    whatsappEnabledCache = settings?.whatsappEnabled ?? true;
  } catch {
    whatsappEnabledCache = true;
  }
  whatsappCacheTime = now;
  return whatsappEnabledCache;
}

export async function getAdminPhone(): Promise<string | null> {
  try {
    const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
    return settings?.adminPhone || null;
  } catch {
    return null;
  }
}

/**
 * Send a plain-text WhatsApp message.
 *
 * NOTE — Meta Cloud API restriction: free-text messages only succeed within
 * a 24-hour "customer service window" (opened when the recipient messages
 * the business first). Outside that window, this call will fail with error
 * 131047 and return false.
 *
 * For any automated / system-initiated message (fines, absences, salary
 * notices, daily reports), use the `send*Template` functions instead —
 * those use approved templates and work any time.
 */
export async function sendWhatsApp(to: string, message: string): Promise<boolean> {
  const normalized = normalizePhone(to);
  if (!normalized) {
    console.warn("[wa] invalid phone:", to);
    return false;
  }

  if (!(await isWhatsAppEnabledCached())) return false;

  if (!isMetaEnabled()) {
    console.warn("[wa] META_WA_ENABLED / token / phoneId missing — skipping send");
    return false;
  }

  const result = await sendMetaText(normalized, message);
  if (!result.success) {
    console.warn(`[wa] meta text FAILED to=${normalized} err="${result.error}"`);
    return false;
  }
  console.log(`[wa] meta text sent to=${normalized} id=${result.messageId}`);
  return true;
}

/**
 * Send an approved Meta template message.
 *
 * @param to            Recipient phone (any format, gets normalized)
 * @param templateName  Exact Meta template name (e.g. "late_notice"),
 *                      must be Approved (not "In review") in WhatsApp Manager
 * @param variables     {"1": value, "2": value, ...} — positional body params
 *                      matching {{1}}, {{2}} in the template body
 */
// Meta rejects template parameters with newlines, tabs, >4 consecutive
// spaces, or empty values (error #132018). This sanitizer runs on every
// template param so a stray multi-line CEO input or DB value never breaks
// a send. Kept here (the single choke point) rather than per-caller.
function sanitizeTemplateParam(value: string): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "-";
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  variables: Record<string, string>
): Promise<boolean> {
  const normalized = normalizePhone(to);
  if (!normalized) {
    console.warn("[wa] invalid phone:", to);
    return false;
  }

  if (!(await isWhatsAppEnabledCached())) return false;

  if (!isMetaEnabled()) {
    console.warn(`[wa] META_WA_ENABLED off — skipping template=${templateName}`);
    return false;
  }

  // Convert the numbered variables object to a positional array, sanitizing each.
  const varCount = Object.keys(variables).length;
  const positional: string[] = [];
  for (let i = 1; i <= varCount; i++) {
    positional.push(sanitizeTemplateParam(variables[String(i)] ?? ""));
  }

  const result = await sendMetaTemplate(normalized, templateName, positional);
  if (!result.success) {
    console.warn(`[wa] meta template=${templateName} FAILED to=${normalized} err="${result.error}"`);
    return false;
  }
  console.log(`[wa] meta template=${templateName} sent to=${normalized} id=${result.messageId}`);
  return true;
}

export async function notifyEmployee(userId: string, message: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user?.phone) return false;
    return sendWhatsApp(user.phone, message);
  } catch {
    return false;
  }
}

export async function notifyAdmin(message: string): Promise<boolean> {
  const phone = await getAdminPhone();
  if (!phone) return false;
  return sendWhatsApp(phone, message);
}

export async function notifyAdmins(message: string): Promise<boolean> {
  const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
  if (!settings?.adminPhone) return false;
  return sendWhatsApp(settings.adminPhone, message);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Template senders — one wrapper per approved Meta template
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function sendLateFineTemplate(
  to: string,
  name: string,
  minutes: number,
  amount: number
): Promise<boolean> {
  return sendWhatsAppTemplate(to, META_TEMPLATE_NAMES.LATE_FINE, {
    "1": name,
    "2": String(minutes),
    "3": String(amount),
  });
}

export async function sendBreakFineTemplate(
  to: string,
  name: string,
  minutes: number,
  amount: number
): Promise<boolean> {
  return sendWhatsAppTemplate(to, META_TEMPLATE_NAMES.BREAK_FINE, {
    "1": name,
    "2": String(minutes),
    "3": String(amount),
  });
}

export async function sendAbsentTemplate(
  to: string,
  name: string,
  amount: number
): Promise<boolean> {
  return sendWhatsAppTemplate(to, META_TEMPLATE_NAMES.ABSENT_NOTICE, {
    "1": name,
    "2": String(amount),
  });
}

export async function sendManualFineTemplate(
  to: string,
  name: string,
  amount: number,
  reason: string
): Promise<boolean> {
  return sendWhatsAppTemplate(to, META_TEMPLATE_NAMES.MANUAL_FINE, {
    "1": name,
    "2": String(amount),
    "3": reason,
  });
}

export async function sendSalaryPaidTemplate(
  to: string,
  name: string,
  amount: number,
  monthName: string
): Promise<boolean> {
  return sendWhatsAppTemplate(to, META_TEMPLATE_NAMES.SALARY_PAID, {
    "1": name,
    "2": monthName,
    "3": String(amount),
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Legacy plain-text message builders (for `sendWhatsApp` free-form sends)
//
// These build nicely-formatted strings that CAN be sent via sendWhatsApp —
// but ONLY within an active 24h customer service window. For automated
// crons, always prefer the `send*Template` functions above.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function lateFineMsg(name: string, minutes: number, amount: number): string {
  return [
    `🚨 *Office — LATE FINE*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Hi ${name},`,
    ``,
    `⏰ You arrived *${minutes} minutes late* today.`,
    `💸 A fine of *PKR ${amount.toLocaleString()}* has been applied.`,
    ``,
    `📊 This will be deducted from your monthly salary.`,
    ``,
    `💡 _Tip: Arrive before 11:10 AM to avoid fines._`,
    ``,
    `⚙️ _System-generated alert — cannot be modified._`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Office Manager`,
  ].join("\n");
}

export function breakFineMsg(name: string, minutes: number, amount: number): string {
  return [
    `🚨 *Office — BREAK FINE*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Hi ${name},`,
    ``,
    `☕ You returned *${minutes} minutes late* from break.`,
    `💸 A fine of *PKR ${amount.toLocaleString()}* has been applied.`,
    ``,
    `📊 This will be deducted from your monthly salary.`,
    ``,
    `💡 _Tip: Break ends at 4:00 PM — return within 5 min grace._`,
    ``,
    `⚙️ _System-generated alert — cannot be modified._`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Office Manager`,
  ].join("\n");
}

export function manualFineMsg(name: string, amount: number, reason: string): string {
  return [
    `🚨 *Office — FINE NOTICE*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Hi ${name},`,
    ``,
    `📋 A fine has been added to your account:`,
    `💸 Amount: *PKR ${amount.toLocaleString()}*`,
    `📝 Reason: _${reason}_`,
    ``,
    `📊 This will be deducted from your monthly salary.`,
    ``,
    `⚙️ _System-generated alert — cannot be modified._`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Office Manager`,
  ].join("\n");
}

export function absentFineMsg(name: string, amount: number): string {
  return [
    `🔴 *Office — ABSENT NOTICE*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Hi ${name},`,
    ``,
    `❌ You were marked *ABSENT* today.`,
    `💸 Deduction: *PKR ${amount.toLocaleString()}* (daily rate)`,
    ``,
    `📊 This will be reflected in your monthly salary.`,
    ``,
    `📌 _If this is incorrect, please contact the CEO immediately._`,
    ``,
    `⚙️ _System-generated alert — cannot be modified._`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Office Manager`,
  ].join("\n");
}

export function autoCheckoutMsg(name: string, timeStr: string): string {
  return [
    `🔔 *Office — AUTO-CHECKOUT*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Hi ${name},`,
    ``,
    `You were automatically checked out at *${timeStr}* because`,
    `you did not check out manually before office closing.`,
    ``,
    `📌 Please remember to check out at the end of each day.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Office Manager`,
  ].join("\n");
}
