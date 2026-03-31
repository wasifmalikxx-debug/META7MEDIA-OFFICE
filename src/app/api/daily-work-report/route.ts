import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { todayPKT, pktMonth, pktYear } from "@/lib/pkt";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const role = (session.user as any).role;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(_pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(_pkt.getUTCFullYear()));

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));

  const where: any = { date: { gte: startOfMonth, lte: endOfMonth } };
  if (role !== "SUPER_ADMIN") {
    where.userId = session.user.id;
  }

  const reports = await prisma.dailyReport.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
    },
    orderBy: { date: "desc" },
  });

  return json(reports);
}

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const body = await request.json();
    const today = todayPKT();
    const userId = session.user.id;

    // Get employee info to determine team
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    if (!user) return error("User not found");

    const isEtsy = user.employeeId.startsWith("EM");
    const isFB = user.employeeId.startsWith("SMM");

    // Validate fields based on team
    if (isEtsy) {
      if (!body.listingsCount && body.listingsCount !== 0) return error("Please enter listings count");
      if (!body.storeName?.trim()) return error("Please enter store name");
      if (!body.listingLinks?.trim()) return error("Please enter listing links");
    } else if (isFB) {
      if (!body.notes?.trim()) return error("Please enter your daily work summary");
    }

    const report = await prisma.dailyReport.upsert({
      where: { userId_date: { userId, date: today } },
      create: {
        userId,
        date: today,
        listingsCount: isEtsy ? (body.listingsCount || 0) : null,
        storeName: isEtsy ? body.storeName : null,
        listingLinks: isEtsy ? body.listingLinks : null,
        postsCount: isFB ? (body.postsCount || 0) : null,
        pageNames: isFB ? body.pageNames : null,
        notes: body.notes || null,
      },
      update: {
        listingsCount: isEtsy ? (body.listingsCount || 0) : undefined,
        storeName: isEtsy ? body.storeName : undefined,
        listingLinks: isEtsy ? body.listingLinks : undefined,
        postsCount: isFB ? (body.postsCount || 0) : undefined,
        pageNames: isFB ? body.pageNames : undefined,
        notes: body.notes || null,
      },
    });

    return json(report, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
