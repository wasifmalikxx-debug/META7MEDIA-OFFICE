import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, serverError, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// L22: length-cap bank details (was unvalidated raw body).
const bankSchema = z.object({
  bankName: z.string().trim().max(120).optional().nullable(),
  accountNumber: z.string().trim().max(60).optional().nullable(),
  accountTitle: z.string().trim().max(120).optional().nullable(),
});

export async function PATCH(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const { bankName, accountNumber, accountTitle } = bankSchema.parse(await request.json());

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        bankName: bankName || null,
        accountNumber: accountNumber || null,
        accountTitle: accountTitle || null,
      },
    });

    return json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return error(err.issues[0]?.message || "Invalid input", 400);
    }
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
