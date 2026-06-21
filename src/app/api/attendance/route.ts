import { NextRequest } from "next/server";
import { json, error, serverError, requireAuth, requireRole, getCallerScope, assertCanActOnUser } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { manualAttendanceSchema } from "@/lib/validations/attendance";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") || session.user.id;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(_pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(_pkt.getUTCFullYear()));
  // Object-level authz (M1): CEO + HR_ADMIN → any employee's attendance (HR's
  // company-wide view); PARTNER → own-team members; MANAGER/EMPLOYEE → self
  // only. The old check only blocked EMPLOYEE, letting a MANAGER/PARTNER read
  // anyone's attendance via ?userId=.
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "HR_ADMIN") {
    const scope = await getCallerScope(session);
    if (!scope) return error("Forbidden", 403);
    const denied = await assertCanActOnUser(scope, userId);
    if (denied) return denied;
  }

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const attendances = await prisma.attendance.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: endDate },
    },
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
    },
    orderBy: { date: "asc" },
  });

  return json(attendances);
}

// Manual attendance entry (admin only)
export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const parsed = manualAttendanceSchema.parse(body);

    const date = new Date(parsed.date);
    date.setHours(0, 0, 0, 0);

    const attendance = await prisma.attendance.upsert({
      where: { userId_date: { userId: parsed.userId, date } },
      create: {
        userId: parsed.userId,
        date,
        status: parsed.status as any,
        checkIn: parsed.checkIn ? new Date(parsed.checkIn) : null,
        checkOut: parsed.checkOut ? new Date(parsed.checkOut) : null,
        notes: parsed.notes,
        isManualEntry: true,
        approvedBy: session.user.id,
        workedMinutes:
          parsed.checkIn && parsed.checkOut
            ? Math.floor(
                (new Date(parsed.checkOut).getTime() -
                  new Date(parsed.checkIn).getTime()) /
                  (1000 * 60)
              )
            : null,
      },
      update: {
        status: parsed.status as any,
        checkIn: parsed.checkIn ? new Date(parsed.checkIn) : undefined,
        checkOut: parsed.checkOut ? new Date(parsed.checkOut) : undefined,
        notes: parsed.notes,
        isManualEntry: true,
        approvedBy: session.user.id,
      },
    });

    return json(attendance);
  } catch (err: any) {
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
