import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  getActiveTokenForUser,
  getProductById,
  extractProductId,
} from "@/lib/services/aliexpress-api.service";
import { prisma } from "@/lib/prisma";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";

/**
 * POST /api/aliexpress/fetch-price
 *
 * Play 5 — Live Margin Calculator.
 *
 * Paste AliExpress URL → get the live price + product metadata.
 * Used by /price-calculator to auto-fill the "AliExpress cost" field
 * (and pull title + image for the listing preview).
 *
 * Access: same as SEO Autopilot. AliExpress side uses CEO's token.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const RequestSchema = z.object({
  url: z.string().min(8).max(500),
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

  const productId = /^\d+$/.test(body.url.trim())
    ? body.url.trim()
    : extractProductId(body.url);
  if (!productId) {
    return error("Couldn't extract product ID from that URL.", 400);
  }

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
    const product = await getProductById(productId, { accessToken });
    if (!product) {
      return error("Product not found on AliExpress", 404);
    }
    return json({
      productId: product.productId,
      title: product.title,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      priceMin: product.priceMin,
      priceMax: product.priceMax,
      currency: product.currency,
      rating: product.rating,
      orderCount: product.orderCount,
    });
  } catch (err) {
    return error(
      `Fetch failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
