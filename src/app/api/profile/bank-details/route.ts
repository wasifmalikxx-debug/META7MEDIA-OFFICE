import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const body = await request.json();
    const { bankName, accountNumber, accountTitle } = body;

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
    return error(err.message);
  }
}
