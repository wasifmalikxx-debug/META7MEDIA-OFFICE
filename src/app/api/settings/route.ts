import { NextRequest } from "next/server";
import { json, error, serverError, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma, invalidateSettingsCache } from "@/lib/prisma";

// Phase 3: settings are per-office. Each request resolves the caller's
// office and reads/writes that office's settings row. Phase 5 will allow
// CEO to query a different office via ?officeId=... query param.
async function getCallerOfficeId(userId: string): Promise<string | null> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { officeId: true },
  });
  return me?.officeId ?? null;
}

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const officeId = await getCallerOfficeId(session.user.id);
    if (!officeId) return error("Your account has no office assigned", 400);

    let settings = await prisma.officeSettings.findUnique({
      where: { officeId },
    });

    if (!settings) {
      settings = await prisma.officeSettings.create({
        data: { officeId },
      });
    }

    return json(settings);
  } catch (err: any) {
    return serverError(err, "Failed to fetch settings", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const officeId = await getCallerOfficeId(session.user.id);
    if (!officeId) return error("Your account has no office assigned", 400);

    const settings = await prisma.officeSettings.upsert({
      where: { officeId },
      create: { officeId, ...body },
      update: body,
    });

    invalidateSettingsCache();

    return json(settings);
  } catch (err: any) {
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
