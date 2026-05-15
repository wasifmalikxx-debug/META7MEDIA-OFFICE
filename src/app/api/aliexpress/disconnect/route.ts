import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/aliexpress/disconnect
 *
 * Wipes the user's stored AliExpress tokens. CEO-only. After this they
 * need to re-authorize via /api/aliexpress/auth-start.
 */

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") {
    return error("CEO-only", 403);
  }
  await prisma.aliExpressToken.deleteMany({
    where: { userId: session.user.id },
  });
  return json({ ok: true });
}
