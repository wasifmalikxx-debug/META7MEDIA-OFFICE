import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  getActiveTokenForUser,
  searchProductsByImage,
} from "@/lib/services/aliexpress-api.service";

/**
 * POST /api/aliexpress/image-search
 *
 * Play 4 — Image-based competitor mining.
 *
 * Accepts:
 *  - { imageUrl: "https://..." } — direct URL (e.g. an Etsy listing image)
 *
 * Returns the top similar products from AliExpress.
 *
 * Access: CEO-only during pilot. Powers the Image Hunt tab inside
 * the Product Hunter hub. (Was originally paired with the now-deleted
 * Reverse Hunt feature — same access gate.)
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  imageUrl: z.string().url().max(500),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  if (session.user.role !== "SUPER_ADMIN") {
    return error("Reverse Hunt is in CEO-only pilot", 403);
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  const accessToken = await getActiveTokenForUser(session.user.id);
  if (!accessToken) {
    return error(
      "AliExpress not connected — connect on Product Hunter first",
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
