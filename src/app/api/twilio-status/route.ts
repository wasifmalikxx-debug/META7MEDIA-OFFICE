import { json, error, requireRole } from "@/lib/api-helpers";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

// GET /api/twilio-status — check Twilio connection status
export async function GET() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  if (!accountSid || !authToken) {
    return json({
      connected: false,
      accountSid: null,
      fromNumber,
      error: "Twilio credentials not configured",
    });
  }

  // Mask the account SID: show first 5 and last 3 characters
  const maskedSid =
    accountSid.slice(0, 5) + "..." + accountSid.slice(-3);

  try {
    // Verify connection by fetching account info
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      return json({
        connected: true,
        accountSid: maskedSid,
        fromNumber,
        status: data.status,
        friendlyName: data.friendly_name,
      });
    } else {
      return json({
        connected: false,
        accountSid: maskedSid,
        fromNumber,
        error: "Failed to connect to Twilio",
      });
    }
  } catch (err: any) {
    return json({
      connected: false,
      accountSid: maskedSid,
      fromNumber,
      error: err.message,
    });
  }
}
