import { NextRequest } from "next/server";
import { json, error, requireAuth, getClientIp } from "@/lib/api-helpers";
import { checkIn, validateIp } from "@/lib/services/attendance.service";

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
    return json(attendance);
  } catch (err: any) {
    return error(err.message);
  }
}
