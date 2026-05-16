import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import {
  claimProduct,
  unclaimProduct,
} from "@/lib/services/daily-trending.service";
import { getDailyTrendingAccess } from "@/lib/services/daily-trending-access";

/**
 * POST   /api/daily-trending/[id]/claim   → claim the product for caller
 * DELETE /api/daily-trending/[id]/claim   → release the claim
 *
 * Claim is a soft-lock — others still see the product, just with a
 * "✓ Claimed by [name]" badge so they know not to race it. Only the
 * original claimer (or CEO) can unclaim.
 *
 * Race-safe: claimProduct() uses a conditional updateMany so two
 * simultaneous clicks resolve cleanly to one winner.
 */

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getDailyTrendingAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) return error("Forbidden", 403);

  const { id } = await context.params;

  // Look up the user's display name for the denormalized claim badge.
  // Cheap query (User.id is the PK) — beats joining on every page render.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { firstName: true, lastName: true },
  });
  const displayName = me
    ? `${me.firstName}${me.lastName ? " " + me.lastName : ""}`.trim()
    : "Someone";

  const result = await claimProduct({
    productId: id,
    userId: session.user.id,
    userName: displayName,
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return error("Product not found", 404);
    }
    if (result.reason?.startsWith("already_claimed:")) {
      const claimer = result.reason.slice("already_claimed:".length);
      return error(`Already claimed by ${claimer}`, 409);
    }
    return error("Could not claim", 500);
  }
  return json({ ok: true, claimedByName: displayName });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getDailyTrendingAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) return error("Forbidden", 403);

  const { id } = await context.params;

  const result = await unclaimProduct({
    productId: id,
    userId: session.user.id,
    isCeo: access.isCeo,
  });

  if (!result.ok) {
    if (result.reason === "not_found") return error("Product not found", 404);
    if (result.reason === "not_owner") {
      return error("Only the claimer (or CEO) can release a claim", 403);
    }
    return error("Could not unclaim", 500);
  }
  return json({ ok: true });
}
