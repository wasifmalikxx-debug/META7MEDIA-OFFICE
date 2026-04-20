/**
 * WhatsApp notification service — Meta Cloud API only.
 *
 * Twilio was removed on 2026-04-20 after the Meta direct integration was
 * validated in production (templates: late_notice, break_fine, absent_fine,
 * manual_fine, salary_paid, daily_report).
 *
 * Kill switch: set OfficeSettings.whatsappEnabled = false in the DB, OR set
 * META_WA_ENABLED != "true" on Vercel. Either disables ALL WhatsApp sends.
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

  // Convert the numbered variables object to a positional array.
  const varCount = Object.keys(variables).length;
  const positional: string[] = [];
  for (let i = 1; i <= varCount; i++) {
    positional.push(variables[String(i)] ?? "");
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

/**
 * Daily sales report — 11-variable Meta template.
 * Today + month-to-date totals plus a multi-line per-employee breakdown.
 */
export interface DailyReportData {
  date: string;
  monthName: string;
  monthly: { orders: number; sale: number; cost: number; profit: number };
  today: { orders: number; sale: number; cost: number; profit: number };
  /** Multi-line breakdown — one block per employee with newlines. Goes into {{11}}. */
  breakdown: string;
}

export async function sendDailyReportTemplate(
  to: string,
  data: DailyReportData
): Promise<boolean> {
  return sendWhatsAppTemplate(to, META_TEMPLATE_NAMES.DAILY_REPORT, {
    "1": data.date,
    "2": data.monthName,
    "3": String(data.monthly.orders),
    "4": data.monthly.sale.toFixed(2),
    "5": data.monthly.cost.toFixed(2),
    "6": data.monthly.profit.toFixed(2),
    "7": String(data.today.orders),
    "8": data.today.sale.toFixed(2),
    "9": data.today.cost.toFixed(2),
    "10": data.today.profit.toFixed(2),
    "11": data.breakdown,
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
    `🚨 *META7MEDIA — LATE FINE*`,
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
    `META7 AI | Office Manager`,
  ].join("\n");
}

export function breakFineMsg(name: string, minutes: number, amount: number): string {
  return [
    `🚨 *META7MEDIA — BREAK FINE*`,
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
    `META7 AI | Office Manager`,
  ].join("\n");
}

export function manualFineMsg(name: string, amount: number, reason: string): string {
  return [
    `🚨 *META7MEDIA — FINE NOTICE*`,
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
    `META7 AI | Office Manager`,
  ].join("\n");
}

export function absentFineMsg(name: string, amount: number): string {
  return [
    `🔴 *META7MEDIA — ABSENT NOTICE*`,
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
    `META7 AI | Office Manager`,
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎉 BONUS MESSAGES (Motivational — plain-text only for now)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function bonusEligibleMsg(name: string, profit: number, bonus: number): string {
  return [
    `🎉 *META7MEDIA — BONUS ACHIEVED!*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Congratulations, *${name}*! 🏆`,
    ``,
    `🚀 Monthly Profit: *$${profit.toLocaleString()}*`,
    `💰 Bonus Earned: *PKR ${bonus.toLocaleString()}*`,
    ``,
    `🌟 Your hard work is paying off!`,
    `Keep pushing — every dollar counts towards`,
    `your next bonus tier! 📈`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `META7MEDIA Management 🏢`,
  ].join("\n");
}

export function reviewBonusApprovedMsg(name: string, storeName: string, amount: number): string {
  return [
    `⭐ *META7MEDIA — REVIEW BONUS APPROVED!*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Great work, *${name}*! 👏`,
    ``,
    `🏪 Store: *${storeName}*`,
    `💰 Bonus: *PKR ${amount.toLocaleString()}*`,
    `✅ Status: *APPROVED*`,
    ``,
    `🌟 Every positive review strengthens our brand.`,
    `Keep delivering excellence! 💪`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `META7MEDIA Management 🏢`,
  ].join("\n");
}

export function teamLeadBonusMsg(name: string, eligibleCount: number, bonus: number): string {
  return [
    `👑 *META7MEDIA — TEAM LEAD BONUS!*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Outstanding, *${name}*! 🎯`,
    ``,
    `👥 Eligible Members: *${eligibleCount}*`,
    `💰 Your Bonus: *PKR ${bonus.toLocaleString()}*`,
    ``,
    `🏆 Your leadership helped ${eligibleCount} team`,
    `member${eligibleCount !== 1 ? "s" : ""} hit their targets this month!`,
    ``,
    `Keep leading by example — the team follows`,
    `your pace! 🚀`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `META7MEDIA Management 🏢`,
  ].join("\n");
}

export function autoCheckoutMsg(name: string, timeStr: string): string {
  return [
    `🔔 *META7MEDIA — AUTO-CHECKOUT*`,
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
    `META7 AI | Office Manager`,
  ].join("\n");
}
