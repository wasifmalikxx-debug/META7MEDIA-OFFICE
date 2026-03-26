import { NextRequest } from "next/server";
import { json, error, requireAuth, getClientIp } from "@/lib/api-helpers";
import { checkIn, validateIp, getOfficeSettings } from "@/lib/services/attendance.service";
import { pktMinutesSinceMidnight } from "@/lib/pkt";

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const ip = getClientIp(request);
  const isValidIp = await validateIp(ip);
  if (!isValidIp) {
    return error("You must be on the office network to check in", 403);
  }

  // Enforce 30-minute check-in window before office start (using PKT)
  const settings = await getOfficeSettings();
  const [wsH, wsM] = (settings?.workStartTime || "11:00").split(":").map(Number);
  const workStartMin = wsH * 60 + wsM;
  const currentMin = pktMinutesSinceMidnight();
  if (currentMin < workStartMin - 30) {
    return error(`Check-in opens 30 minutes before office hours (${settings?.workStartTime || "11:00"})`, 400);
  }

  try {
    const body = await request.json();
    const attendance = await checkIn(
      session.user.id,
      ip,
      body.latitude,
      body.longitude
    );

    return json(attendance);
  } catch (err: any) {
    return error(err.message);
  }
}
