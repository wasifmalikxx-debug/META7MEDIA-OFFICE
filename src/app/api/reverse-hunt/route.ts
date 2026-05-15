import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { getActiveTokenForUser } from "@/lib/services/aliexpress-api.service";
import { reverseHunt } from "@/lib/services/reverse-hunt.service";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

/**
 * POST /api/reverse-hunt
 *
 * Play 2: Paste an AliExpress URL or product ID → get an Etsy demand
 * verdict + projected margin in ~5 seconds.
 *
 * Access: CEO + Izaan + EM employees + Etsy partners (same as the
 * SEO Autopilot tool). The team will use this constantly.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  input: z.string().min(8).max(500),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getSeoAutopilotAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) {
    return error("Forbidden", 403);
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // Use the CEO's stored token for the AliExpress call (only one
  // connected account at the company level — non-CEO users borrow it
  // for their own lookups).
  const { prisma } = await import("@/lib/prisma");
  const ceoUser = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (!ceoUser) return error("No CEO user configured", 500);

  const accessToken = await getActiveTokenForUser(ceoUser.id);
  if (!accessToken) {
    return error(
      "AliExpress not connected — ask Wasif to connect via /seo-autopilot/product-hunter",
      409,
    );
  }

  try {
    const result = await reverseHunt(body.input, accessToken);
    return json(result);
  } catch (err) {
    return error(
      `Reverse hunt failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
