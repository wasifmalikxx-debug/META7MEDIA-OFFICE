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

// Check if WhatsApp is enabled in settings
async function isWhatsAppEnabled(): Promise<boolean> {
  try {
    const settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
    return settings?.whatsappEnabled ?? true;
  } catch {
    return true; // Default to enabled if can't read settings
  }
}

// Get admin phone for CEO alerts
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
  if (!enabled) {
    console.log("WhatsApp disabled in settings, skipping");
    return false;
  }

  const twilioClient = getClient();
  if (!twilioClient) {
    console.warn("Twilio not configured, skipping WhatsApp message");
    return false;
  }

  try {
    const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    await twilioClient.messages.create({
      body: message,
      from: fromNumber,
      to: toNumber,
    });
    console.log(`WhatsApp sent to ${to}: ${message.substring(0, 50)}...`);
    return true;
  } catch (err: any) {
    console.error(`WhatsApp failed to ${to}:`, err.message);
    return false;
  }
}

// Helper: send to employee if they have a phone number
export async function notifyEmployee(userId: string, message: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user?.phone) return false;
    return sendWhatsApp(user.phone, message);
  } catch {
    return false;
  }
}

// Helper: send to CEO/admin
export async function notifyAdmin(message: string): Promise<boolean> {
  const phone = await getAdminPhone();
  if (!phone) return false;
  return sendWhatsApp(phone, message);
}

// ─── EMPLOYEE TEMPLATES ───

export function checkInMsg(name: string, time: string): string {
  return `☀️ Good morning ${name}! Checked in at ${time}. Have a productive day! — META7MEDIA`;
}

export function checkOutMsg(name: string, hours: string): string {
  return `✅ Day complete, ${name}! You worked ${hours} today. See you tomorrow! — META7MEDIA`;
}

export function lateArrivalMsg(name: string, minutes: number): string {
  return `⚠️ Hi ${name}, you arrived ${minutes} minutes late today. A late fine has been applied. — META7MEDIA`;
}

export function breakLateMsg(name: string, minutes: number, amount: number): string {
  return `⚠️ Hi ${name}, you returned ${minutes} min late from break. Fine of PKR ${amount.toLocaleString()} applied. — META7MEDIA`;
}

export function halfDayAppliedMsg(name: string, date: string): string {
  return `📝 Hi ${name}, your half day leave for ${date} has been recorded and auto-approved. — META7MEDIA`;
}

export function fineAddedMsg(name: string, amount: number, reason: string): string {
  return `🔴 Hi ${name}, a fine of PKR ${amount.toLocaleString()} has been added: ${reason}. — META7MEDIA`;
}

export function incentiveAwardedMsg(name: string, amount: number, reason: string): string {
  return `🎉 Congrats ${name}! Incentive of PKR ${amount.toLocaleString()} awarded: ${reason}. — META7MEDIA`;
}

export function absentMarkedMsg(name: string, date: string): string {
  return `❌ Hi ${name}, you were marked absent on ${date}. If this is incorrect, please contact admin. — META7MEDIA`;
}

export function checkoutReminderMsg(name: string): string {
  return `⏰ Hi ${name}, you haven't checked out yet! Please check out before office closing time. — META7MEDIA`;
}

export function autoCheckoutMsg(name: string, time: string): string {
  return `📋 Hi ${name}, you forgot to check out today. System auto-checked you out at ${time}. Please remember to check out tomorrow. — META7MEDIA`;
}

export function salaryProcessedMsg(name: string, amount: number, month: string): string {
  return `💰 Hi ${name}, your salary for ${month} has been processed. Net payable: PKR ${amount.toLocaleString()}. — META7MEDIA`;
}

export function payrollDetailMsg(
  name: string, month: string, gross: number, fines: number, incentives: number, net: number
): string {
  return `💰 Salary Summary — ${month}\n\nHi ${name},\nGross: PKR ${gross.toLocaleString()}\nFines: -PKR ${fines.toLocaleString()}\nIncentives: +PKR ${incentives.toLocaleString()}\nNet Payable: PKR ${net.toLocaleString()}\n\n— META7MEDIA`;
}

// ─── CEO/ADMIN TEMPLATES ───

export function adminLateAlertMsg(empName: string, minutes: number): string {
  return `🔔 ${empName} arrived ${minutes} min late. Fine auto-applied. — META7MEDIA AI`;
}

export function adminAbsentAlertMsg(empName: string): string {
  return `🔴 ${empName} didn't show up today. Marked absent. — META7MEDIA AI`;
}

export function adminLeaveAlertMsg(empName: string, date: string): string {
  return `📝 ${empName} applied half day leave for ${date}. Auto-approved. — META7MEDIA AI`;
}

export function adminDailySummaryMsg(
  present: number, absent: number, late: number, onLeave: number
): string {
  const total = present + absent + late + onLeave;
  return `📊 Daily Summary\n\nTotal: ${total}\n✅ Present: ${present}\n❌ Absent: ${absent}\n⏰ Late: ${late}\n📝 On Leave: ${onLeave}\n\n— META7MEDIA AI`;
}

export function adminFineAlertMsg(empName: string, amount: number, reason: string): string {
  return `🔴 Fine issued to ${empName}: PKR ${amount.toLocaleString()} — ${reason}. — META7MEDIA AI`;
}

export function adminIncentiveAlertMsg(empName: string, amount: number): string {
  return `🎉 Incentive of PKR ${amount.toLocaleString()} awarded to ${empName}. — META7MEDIA AI`;
}
