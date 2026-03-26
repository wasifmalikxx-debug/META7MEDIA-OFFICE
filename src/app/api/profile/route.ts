import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function PUT(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const body = await request.json();
    const { firstName, lastName, email, phone, phone2 } = body;

    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone || null;
    if (phone2 !== undefined) updateData.phone2 = phone2 || null;

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        phone2: true,
      },
    });

    return json(updated);
  } catch (err: any) {
    if (err.code === "P2002") {
      return error("Email already in use", 400);
    }
    return error(err.message);
  }
}
