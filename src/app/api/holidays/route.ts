import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));

  const holidays = await prisma.holiday.findMany({
    where: { year },
    orderBy: { date: "asc" },
  });

  return json(holidays);
}

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN", "HR_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const { name, date } = body;

    if (!name || !date) return error("Name and date are required");

    const holidayDate = new Date(date);
    holidayDate.setHours(0, 0, 0, 0);

    const holiday = await prisma.holiday.create({
      data: {
        name,
        date: holidayDate,
        year: holidayDate.getFullYear(),
      },
    });

    return json(holiday, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
