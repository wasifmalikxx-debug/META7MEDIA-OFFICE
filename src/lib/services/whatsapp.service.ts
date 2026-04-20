import twilio from "twilio";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/pkt";
import {
  isMetaEnabled,
  sendMetaTemplate,
  META_TEMPLATE_NAMES,
} from "@/lib/services/whatsapp-meta.service";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+15559046375";

// WhatsApp Content Template SIDs (approved templates for business-initiated messages)
const TEMPLATE_SIDS = {
  LATE_FINE: "HXfce39a3569ffad47b22625cc16b116c4",
  BREAK_FINE: "HXf41493217eeb444c2f0464d5050a7ddc",
  ABSENT_NOTICE: "HX4eff0dadd07b2f8bc12db6382a371273",
  DAILY_REPORT: "HX218eb0b8d4bf1e215052490f138a8547",
  SALARY_PAID: "HX81c37b6f4ead2fe7a42a1be56c0b1630",
  MANUAL_FINE: "HX0eb29332a3268de88d94fac0e34c477f",
};

// Maps internal template key → Meta-approved template name. Must stay in
// sync with TEMPLATE_SIDS above and META_TEMPLATE_NAMES in the Meta service.
const META_NAME_MAP: Record<keyof typeof TEMPLATE_SIDS, string> = {
  LATE_FINE: META_TEMPLATE_NAMES.LATE_FINE,
  BREAK_FINE: META_TEMPLATE_NAMES.BREAK_FINE,
  ABSENT_NOTICE: META_TEMPLATE_NAMES.ABSENT_NOTICE,
  DAILY_REPORT: META_TEMPLATE_NAMES.DAILY_REPORT,
  SALARY_PAID: META_TEMPLATE_NAMES.SALARY_PAID,
  MANUAL_FINE: META_TEMPLATE_NAMES.MANUAL_FINE,
};

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!client && accountSid && authToken) {
    client = twilio(accountSid, authToken);
  }
  return client;
}

async function isWhatsAppEnabled(): Promise<boolean> {
  try {
    const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
    return settings?.whatsappEnabled ?? true;
  } catch {
    return true;
  }
}

export async function getAdminPhone(): Promise<string | null> {
  try {
    const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
    return settings?.adminPhone || null;
  } catch {
    return null;
  }
}

export async function sendWhatsApp(to: string, message: string): Promise<boolean> {
  const normalized = normalizePhone(to);
  if (!normalized) { console.warn("Invalid phone:", to); return false; }

  const enabled = await isWhatsAppEnabledCached();
  if (!enabled) return false;

  const twilioClient = getClient();
  if (!twilioClient) {
    console.warn("Twilio not configured, skipping WhatsApp message");
    return false;
  }

  try {
    const toNumber = normalized.startsWith("whatsapp:") ? normalized : `whatsapp:${normalized}`;
    await twilioClient.messages.create({ body: message, from: fromNumber, to: toNumber });
    console.log(`WhatsApp sent to ${normalized}`);
    return true;
  } catch (err: any) {
    console.error(`WhatsApp failed to ${normalized}:`, err.message);
    return false;
  }
}

// Cache WhatsApp enabled status for 60s to avoid DB hit on every message
let whatsappEnabledCache: boolean | null = null;
let whatsappCacheTime = 0;

async function isWhatsAppEnabledCached(): Promise<boolean> {
  const now = Date.now();
  if (whatsappEnabledCache !== null && now - whatsappCacheTime < 60_000) {
    return whatsappEnabledCache;
  }
  whatsappEnabledCache = await isWhatsAppEnabled();
  whatsappCacheTime = now;
  return whatsappEnabledCache;
}

export async function sendWhatsAppTemplate(
  to: string,
  templateSid: string,
  variables: Record<string, string>
): Promise<boolean> {
  const normalized = normalizePhone(to);
  if (!normalized) { console.warn("Invalid phone:", to); return false; }

  const enabled = await isWhatsAppEnabledCached();
  if (!enabled) return false;

  // ── Meta path (if feature flag + creds are configured) ─────────────
  // Convert numbered variables { "1": "...", "2": "..." } → positional array
  // and look up the template name that corresponds to this Twilio SID.
  if (isMetaEnabled()) {
    const templateKey = Object.entries(TEMPLATE_SIDS).find(
      ([, sid]) => sid === templateSid
    )?.[0] as keyof typeof TEMPLATE_SIDS | undefined;

    if (templateKey) {
      const metaName = META_NAME_MAP[templateKey];
      // Build positional args in order {{1}}, {{2}}, ...
      const positional: string[] = [];
      const varCount = Object.keys(variables).length;
      for (let i = 1; i <= varCount; i++) {
        positional.push(variables[String(i)] ?? "");
      }
      const result = await sendMetaTemplate(normalized, metaName, positional);
      if (result.success) {
        console.log(`[wa] meta sent template=${metaName} to=${normalized} id=${result.messageId}`);
        return true;
      }
      // Meta failed — log the reason and fall through to Twilio fallback.
      console.warn(
        `[wa] meta FAILED template=${metaName} to=${normalized} err="${result.error}" — falling back to Twilio`
      );
    } else {
      console.warn(`[wa] no Meta name mapped for Twilio SID ${templateSid}, using Twilio`);
    }
  }

  // ── Twilio path (default + Meta fallback) ─────────────────────────
  const twilioClient = getClient();
  if (!twilioClient) {
    console.warn("Twilio not configured, skipping WhatsApp template");
    return false;
  }

  try {
    const toNumber = normalized.startsWith("whatsapp:") ? normalized : `whatsapp:${normalized}`;
    await twilioClient.messages.create({
      contentSid: templateSid,
      contentVariables: JSON.stringify(variables),
      from: fromNumber,
      to: toNumber,
    });
    console.log(`WhatsApp template sent to ${normalized}`);
    return true;
  } catch (err: any) {
    console.error(`WhatsApp template failed to ${normalized}:`, err.message);
    return false;
  }
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚨 FINE MESSAGES (System Generated — Cannot Be Modified)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function lateFineMsg(name: string, minutes: number, amount: number): string {
  return [
    `🚨 *META7MEDIA — FINE ALERT*`,
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

export async function sendLateFineTemplate(to: string, name: string, minutes: number, amount: number): Promise<boolean> {
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.LATE_FINE, {
    "1": name, "2": String(minutes), "3": String(amount),
  });
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

export async function sendBreakFineTemplate(to: string, name: string, minutes: number, amount: number): Promise<boolean> {
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.BREAK_FINE, {
    "1": name, "2": String(minutes), "3": String(amount),
  });
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

export async function sendAbsentTemplate(to: string, name: string, amount: number): Promise<boolean> {
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.ABSENT_NOTICE, {
    "1": name, "2": String(amount),
  });
}

/**
 * Daily sales report — two possible payload shapes depending on which
 * WhatsApp provider is live:
 *
 *  - Meta (new template, 11 variables): date, monthName, monthly totals,
 *    today's totals, and a multi-line per-employee breakdown with emojis.
 *  - Twilio (legacy template, 5 variables): date, today's orders/sale/
 *    profit, and a flat single-line breakdown with `|` separators.
 *
 * The cron builds both breakdown strings and passes the full data object —
 * this function picks the right path based on the META_WA_ENABLED flag.
 */
export interface DailyReportData {
  date: string;
  monthName: string;
  monthly: { orders: number; sale: number; cost: number; profit: number };
  today: { orders: number; sale: number; cost: number; profit: number };
  breakdownMultiline: string; // Meta's {{11}} — with emojis + newlines
  breakdownFlat: string;      // Twilio's legacy 5th variable — single line
}

export async function sendDailyReportTemplate(to: string, data: DailyReportData): Promise<boolean> {
  const normalized = normalizePhone(to);
  if (!normalized) { console.warn("Invalid phone:", to); return false; }

  const enabled = await isWhatsAppEnabledCached();
  if (!enabled) return false;

  // Meta path: new 11-variable daily_report template
  if (isMetaEnabled()) {
    const positional = [
      data.date,                           // {{1}} date
      data.monthName,                      // {{2}} month name
      String(data.monthly.orders),         // {{3}} monthly orders
      data.monthly.sale.toFixed(2),        // {{4}} monthly sale
      data.monthly.cost.toFixed(2),        // {{5}} monthly cost
      data.monthly.profit.toFixed(2),      // {{6}} monthly profit
      String(data.today.orders),           // {{7}} today orders
      data.today.sale.toFixed(2),          // {{8}} today sale
      data.today.cost.toFixed(2),          // {{9}} today cost
      data.today.profit.toFixed(2),        // {{10}} today profit
      data.breakdownMultiline,             // {{11}} individual breakdown
    ];
    const result = await sendMetaTemplate(normalized, META_TEMPLATE_NAMES.DAILY_REPORT, positional);
    if (result.success) {
      console.log(`[wa] meta daily_report sent to=${normalized} id=${result.messageId}`);
      return true;
    }
    console.warn(`[wa] meta daily_report FAILED err="${result.error}" — falling back to Twilio`);
  }

  // Twilio path: legacy 5-variable template (today-only, flat breakdown)
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.DAILY_REPORT, {
    "1": data.date,
    "2": String(data.today.orders),
    "3": `$${data.today.sale.toFixed(2)}`,
    "4": `$${data.today.profit.toFixed(2)}`,
    "5": data.breakdownFlat,
  });
}

export async function sendManualFineTemplate(to: string, name: string, amount: number, reason: string): Promise<boolean> {
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.MANUAL_FINE, {
    "1": name, "2": String(amount), "3": reason,
  });
}

export async function sendSalaryPaidTemplate(to: string, name: string, amount: number, monthName: string): Promise<boolean> {
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.SALARY_PAID, {
    "1": name, "2": monthName, "3": String(amount),
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎉 BONUS MESSAGES (Motivational)
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
    `your energy! 🔥`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `META7MEDIA Management 🏢`,
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 💰 SALARY MESSAGES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function salaryPaidMsg(name: string, amount: number, monthName: string): string {
  return [
    `💰 *META7MEDIA — SALARY CREDITED!*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Hi *${name}*,`,
    ``,
    `📅 Month: *${monthName}*`,
    `💵 Net Salary: *PKR ${amount.toLocaleString()}*`,
    `✅ Status: *PAID*`,
    ``,
    `🏦 Payment processed via Bank Alfalah.`,
    `Check your payroll for full breakdown.`,
    ``,
    `🙏 Thank you for your dedication!`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `META7MEDIA Management 🏢`,
  ].join("\n");
}
