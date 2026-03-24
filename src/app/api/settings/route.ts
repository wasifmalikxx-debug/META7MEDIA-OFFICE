import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  let settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
  });

  if (!settings) {
    settings = await prisma.officeSettings.create({
      data: { id: "default" },
    });
  }

  return json(settings);
}

export async function PATCH(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();

    const settings = await prisma.officeSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...body },
      update: body,
    });

    return json(settings);
  } catch (err: any) {
    return error(err.message);
  }
}
