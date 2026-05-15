import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  getActiveTokenForUser,
  searchProductsByImage,
} from "@/lib/services/aliexpress-api.service";
import { prisma } from "@/lib/prisma";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

/**
 * POST /api/aliexpress/image-search
 *
 * Play 4 — Image-based competitor mining.
 *
 * Accepts either:
 *  - { imageUrl: "https://..." } — direct URL (e.g. an Etsy listing image)
 *  - { imageBase64: "..." } — uploaded image (we host briefly then send URL)
 *
 * Returns the top similar products from AliExpress. Useful for
 * "I saw this on a competitor's Etsy shop, find me the supplier."
 *
 * Access: CEO + Izaan + EM + Etsy partners (same as Reverse Hunt).
 * AliExpress side uses the CEO's connected token.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  imageUrl: z.string().url().max(500),
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

  // Use CEO's token for the AliExpress side
  const ceoUser = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (!ceoUser) return error("No CEO user configured", 500);

  const accessToken = await getActiveTokenForUser(ceoUser.id);
  if (!accessToken) {
    return error(
      "AliExpress not connected — ask Wasif to connect on Product Hunter",
      409,
    );
  }

  try {
    const result = await searchProductsByImage(body.imageUrl, {
      accessToken,
      pageSize: 12,
    });
    return json(result);
  } catch (err) {
    return error(
      `Image search failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
