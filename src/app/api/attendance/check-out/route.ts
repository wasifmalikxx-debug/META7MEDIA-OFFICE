import { NextRequest } from "next/server";
import { json, error, requireAuth, getClientIp } from "@/lib/api-helpers";
import { checkOut } from "@/lib/services/attendance.service";

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const ip = getClientIp(request);

  try {
    const body = await request.json();
    const attendance = await checkOut(
      session.user.id,
      ip,
      body.latitude,
      body.longitude
    );

    // WhatsApp checkout notification
    const name = (session.user as any).name || "Employee";
    const hours = attendance.workedMinutes
      ? `${Math.floor(attendance.workedMinutes / 60)}h ${attendance.workedMinutes % 60}m`
      : "N/A";
    const { notifyEmployee, checkOutMsg } = await import("@/lib/services/whatsapp.service");
    notifyEmployee(session.user.id, checkOutMsg(name, hours));

    return json(attendance);
  } catch (err: any) {
    return error(err.message);
  }
}
