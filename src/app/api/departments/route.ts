import { NextRequest } from "next/server";
import { json, error, serverError, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const departments = await prisma.department.findMany({
    include: {
      teams: true,
      _count: { select: { users: true } },
    },
    orderBy: { name: "asc" },
  });

  return json(departments);
}

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const { name, headId, officeId: bodyOfficeId } = body;

    if (!name) return error("Department name is required");

    // Phase 3: every department belongs to an office. The CEO's New
    // Department dialog now sends an explicit `officeId` so they can file
    // under OFFICE 1 or OFFICE 2. If absent (legacy / partner clients),
    // fall back to the caller's own officeId.
    let officeId = bodyOfficeId as string | undefined;
    if (!officeId) {
      const me = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { officeId: true },
      });
      officeId = me?.officeId ?? undefined;
    } else {
      // Validate the provided officeId actually exists to avoid FK errors.
      const exists = await prisma.office.findUnique({ where: { id: officeId }, select: { id: true } });
      if (!exists) return error("Invalid office", 400);
    }
    if (!officeId) return error("User has no office assigned", 400);

    const department = await prisma.department.create({
      data: { name, headId, officeId },
    });

    return json(department, 201);
  } catch (err: any) {
    // Surface the unique-constraint collision (same name within same office)
    // as a friendly message rather than the raw Prisma error string.
    if (typeof err?.message === "string" && err.message.includes("Unique constraint")) {
      return error("A department with that name already exists in this office.");
    }
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
