import twilio from "twilio";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/pkt";

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

export async function sendDailyReportTemplate(to: string, date: string, orders: string, sale: string, profit: string, breakdown: string): Promise<boolean> {
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.DAILY_REPORT, {
    "1": date, "2": orders, "3": sale, "4": profit, "5": breakdown,
  });
}

export async function sendManualFineTemplate(to: string, name: string, amount: number, reason: string): Promise<boolean> {
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.MANUAL_FINE, {
    "1": name, "2": String(amount), "3": reason,
  });
}

export async function sendSalaryPaidTemplate(to: string, name: string, amount: number, monthName: string): Promise<boolean> {
  return sendWhatsAppTemplate(to, TEMPLATE_SIDS.SALARY_PAID, {
    "1": name, "2": String(amount), "3": monthName,
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
