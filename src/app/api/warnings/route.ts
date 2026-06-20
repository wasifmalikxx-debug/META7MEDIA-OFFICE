import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { createNotification } from "@/lib/services/notification.service";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const role = (session.user as any).role;
  const userId = searchParams.get("userId");

  // Object-level authz (M2): CEO + HR_ADMIN → all warnings (optionally drilled
  // to ?userId=); everyone else → self only. The old code let any non-EMPLOYEE
  // read every employee's warnings (empty where = full dump) or any single one
  // via ?userId=. Matches the incentives page's admin-vs-self model.
  const where: any = {};
  if (role === "SUPER_ADMIN" || role === "HR_ADMIN") {
    if (userId) where.userId = userId;
  } else {
    where.userId = session.user.id;
  }

  const warnings = await prisma.warning.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      issuedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json(warnings);
}

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const { userId, level, reason, details } = body;

    if (!userId || !level || !reason) {
      return error("userId, level, and reason are required");
    }

    const warning = await prisma.warning.create({
      data: {
        userId,
        level: level as any,
        reason,
        details,
        date: nowPKT(),
        issuedById: session.user.id,
      },
    });

    await createNotification(
      userId,
      "WARNING_ISSUED",
      "Warning Issued",
      `A ${level} warning has been issued. Reason: ${reason}`,
      "/warnings"
    );

    return json(warning, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
