import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, serverError, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// L22: validate + length-cap profile edits (was unvalidated raw body — no email
// format check, no length limits).
const profileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().email("Invalid email").max(200).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  phone2: z.string().trim().max(30).optional().nullable(),
});

export async function PUT(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const parsed = profileSchema.parse(await request.json());

    const updateData: any = {};
    if (parsed.firstName !== undefined) updateData.firstName = parsed.firstName;
    if (parsed.lastName !== undefined) updateData.lastName = parsed.lastName;
    if (parsed.email !== undefined) updateData.email = parsed.email;
    if (parsed.phone !== undefined) updateData.phone = parsed.phone || null;
    if (parsed.phone2 !== undefined) updateData.phone2 = parsed.phone2 || null;

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
    if (err instanceof z.ZodError) {
      return error(err.issues[0]?.message || "Invalid input", 400);
    }
    if (err.code === "P2002") {
      return error("Email already in use", 400);
    }
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
