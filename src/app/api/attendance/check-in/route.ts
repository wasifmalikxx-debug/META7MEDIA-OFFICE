import { NextRequest } from "next/server";
import { json, error, requireAuth, getClientIp } from "@/lib/api-helpers";
import { checkIn, validateIp } from "@/lib/services/attendance.service";
import { notifyEmployee, notifyAdmin, checkInMsg, lateArrivalMsg, adminLateAlertMsg } from "@/lib/services/whatsapp.service";

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const ip = getClientIp(request);
  const isValidIp = await validateIp(ip);
  if (!isValidIp) {
    return error("You must be on the office network to check in", 403);
  }

  try {
    const body = await request.json();
    const attendance = await checkIn(
      session.user.id,
      ip,
      body.latitude,
      body.longitude
    );

    // WhatsApp notifications (async, don't block response)
    const name = (session.user as any).name || "Employee";
    const time = new Date().toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

    if (attendance.status === "LATE" && attendance.lateMinutes) {
      // Late: notify employee + CEO
      notifyEmployee(session.user.id, lateArrivalMsg(name, attendance.lateMinutes));
      notifyAdmin(adminLateAlertMsg(name, attendance.lateMinutes));
    } else {
      // On time: friendly check-in message
      notifyEmployee(session.user.id, checkInMsg(name, time));
    }

    return json(attendance);
  } catch (err: any) {
    return error(err.message);
  }
}
