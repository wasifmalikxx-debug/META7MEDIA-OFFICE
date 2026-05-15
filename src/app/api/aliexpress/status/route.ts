import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/aliexpress/status
 *
 * Returns whether the current user has an active AliExpress token.
 * Lets the UI render "Connect" vs "Connected as X" without leaking the
 * token itself.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const token = await prisma.aliExpressToken.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      aliUserNick: true,
      aliUserId: true,
      expiresAt: true,
      refreshExpiresAt: true,
      createdAt: true,
    },
  });

  if (!token) return json({ connected: false });

  const now = Date.now();
  const expired = token.expiresAt.getTime() < now;
  return json({
    connected: true,
    expired,
    aliUserNick: token.aliUserNick,
    aliUserId: token.aliUserId,
    expiresAt: token.expiresAt.toISOString(),
    connectedAt: token.createdAt.toISOString(),
  });
}
