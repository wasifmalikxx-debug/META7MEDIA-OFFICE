import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
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
    const { name, headId } = body;

    if (!name) return error("Department name is required");

    const department = await prisma.department.create({
      data: { name, headId },
    });

    return json(department, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
