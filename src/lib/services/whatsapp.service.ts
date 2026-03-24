import twilio from "twilio";

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

export async function sendWhatsApp(to: string, message: string): Promise<boolean> {
  const twilioClient = getClient();
  if (!twilioClient) {
    console.warn("Twilio not configured, skipping WhatsApp message");
    return false;
  }

  try {
    // Ensure number is in whatsapp: format
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

// Pre-built message templates
export function checkoutReminderMsg(name: string): string {
  return `⏰ Hi ${name}, you haven't checked out yet! Please check out before office closing time. — META7MEDIA Office`;
}

export function autoCheckoutMsg(name: string, time: string): string {
  return `📋 Hi ${name}, you forgot to check out today. System auto-checked you out at ${time}. Please remember to check out tomorrow. — META7MEDIA Office`;
}

export function lateArrivalMsg(name: string, minutes: number): string {
  return `⚠️ Hi ${name}, you arrived ${minutes} minutes late today. A late fine has been applied. — META7MEDIA Office`;
}

export function halfDayAppliedMsg(name: string, date: string): string {
  return `📝 Hi ${name}, your half day leave for ${date} has been recorded. — META7MEDIA Office`;
}

export function fineAddedMsg(name: string, amount: number, reason: string): string {
  return `🔴 Hi ${name}, a fine of PKR ${amount.toLocaleString()} has been added: ${reason}. — META7MEDIA Office`;
}

export function salaryProcessedMsg(name: string, amount: number, month: string): string {
  return `💰 Hi ${name}, your salary for ${month} has been processed. Net payable: PKR ${amount.toLocaleString()}. — META7MEDIA Office`;
}
