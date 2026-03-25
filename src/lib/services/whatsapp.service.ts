import twilio from "twilio";
import { prisma } from "@/lib/prisma";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

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
  const enabled = await isWhatsAppEnabled();
  if (!enabled) return false;

  const twilioClient = getClient();
  if (!twilioClient) {
    console.warn("Twilio not configured, skipping WhatsApp message");
    return false;
  }

  try {
    const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    await twilioClient.messages.create({ body: message, from: fromNumber, to: toNumber });
    console.log(`WhatsApp sent to ${to}`);
    return true;
  } catch (err: any) {
    console.error(`WhatsApp failed to ${to}:`, err.message);
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

// ─── FINE MESSAGES (System Generated) ───

export function lateFineMsg(name: string, minutes: number, amount: number): string {
  return [
    `META7MEDIA — Fine Notice`,
    ``,
    `Dear ${name},`,
    ``,
    `A late arrival fine of *PKR ${amount.toLocaleString()}* has been applied to your account.`,
    `You arrived *${minutes} minutes* after the allowed grace period.`,
    ``,
    `This deduction will be reflected in your monthly salary.`,
    ``,
    `_This is a system-generated notification and cannot be modified._`,
    `— META7 AI`,
  ].join("\n");
}

export function breakFineMsg(name: string, minutes: number, amount: number): string {
  return [
    `META7MEDIA — Fine Notice`,
    ``,
    `Dear ${name},`,
    ``,
    `A break violation fine of *PKR ${amount.toLocaleString()}* has been applied.`,
    `You returned *${minutes} minutes* late from your scheduled break.`,
    ``,
    `This deduction will be reflected in your monthly salary.`,
    ``,
    `_This is a system-generated notification and cannot be modified._`,
    `— META7 AI`,
  ].join("\n");
}

export function manualFineMsg(name: string, amount: number, reason: string): string {
  return [
    `META7MEDIA — Fine Notice`,
    ``,
    `Dear ${name},`,
    ``,
    `A fine of *PKR ${amount.toLocaleString()}* has been added to your account.`,
    `Reason: ${reason}`,
    ``,
    `This deduction will be reflected in your monthly salary.`,
    ``,
    `_This is a system-generated notification and cannot be modified._`,
    `— META7 AI`,
  ].join("\n");
}

// ─── BONUS MESSAGES (Motivational) ───

export function bonusEligibleMsg(name: string, profit: number, bonus: number): string {
  return [
    `META7MEDIA — Bonus Alert`,
    ``,
    `Congratulations ${name}! 🎉`,
    ``,
    `You have achieved a total profit of *$${profit.toLocaleString()}* this month.`,
    `Your performance bonus of *PKR ${bonus.toLocaleString()}* has been credited!`,
    ``,
    `Keep up the amazing work — your dedication makes a difference!`,
    ``,
    `— META7MEDIA Management`,
  ].join("\n");
}

export function reviewBonusApprovedMsg(name: string, storeName: string, amount: number): string {
  return [
    `META7MEDIA — Review Bonus Approved`,
    ``,
    `Great job ${name}!`,
    ``,
    `Your review fix for store *${storeName}* has been approved.`,
    `*PKR ${amount.toLocaleString()}* has been added to your incentives.`,
    ``,
    `Every positive review counts — keep delivering excellence!`,
    ``,
    `— META7MEDIA Management`,
  ].join("\n");
}

export function teamLeadBonusMsg(name: string, eligibleCount: number, bonus: number): string {
  return [
    `META7MEDIA — Team Lead Bonus`,
    ``,
    `Well done ${name}!`,
    ``,
    `*${eligibleCount} team member${eligibleCount !== 1 ? "s" : ""}* achieved their bonus targets this month.`,
    `Your team lead bonus of *PKR ${bonus.toLocaleString()}* has been credited!`,
    ``,
    `Your leadership is making the team stronger every day.`,
    ``,
    `— META7MEDIA Management`,
  ].join("\n");
}

// ─── SALARY MESSAGES ───

export function salaryPaidMsg(name: string, amount: number, monthName: string): string {
  return [
    `META7MEDIA — Salary Confirmation`,
    ``,
    `Dear ${name},`,
    ``,
    `Your salary for *${monthName}* has been processed and marked as *PAID*.`,
    ``,
    `Net Amount: *PKR ${amount.toLocaleString()}*`,
    ``,
    `Thank you for your hard work and commitment.`,
    ``,
    `— META7MEDIA Management`,
  ].join("\n");
}
