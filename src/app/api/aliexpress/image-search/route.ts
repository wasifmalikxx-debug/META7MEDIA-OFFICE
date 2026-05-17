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
 * Accepts one of:
 *  - { imageUrl: "https://..." }   — direct URL (e.g. Etsy listing image)
 *  - { imageBase64: "..." }        — file upload or clipboard paste,
 *                                    sent as a base64-encoded data URI
 *                                    or raw base64 string
 *
 * Returns the top similar products from AliExpress.
 *
 * Access: CEO-only during pilot. Powers the Image Hunt tab inside
 * the Product Hunter hub.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Body size cap — must stay UNDER Vercel's serverless 4.5MB body limit.
// Client resizes any uploaded image to ≤1024×1024 JPEG @ 0.85, which
// yields ~100-500KB base64. 3MB cap here is comfortable headroom; if
// anything close to this hits the API it's almost certainly an attack
// or a misconfigured client.
const MAX_BASE64_CHARS = 3 * 1024 * 1024;

const RequestSchema = z
  .object({
    imageUrl: z.string().url().max(500).optional(),
    imageBase64: z.string().max(MAX_BASE64_CHARS).optional(),
  })
  .refine((d) => Boolean(d.imageUrl || d.imageBase64), {
    message: "Either imageUrl or imageBase64 is required",
  });

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  if (session.user.role !== "SUPER_ADMIN") {
    return error("Image Hunt is in CEO-only pilot", 403);
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return error(
        err.issues
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join(" · "),
        400,
      );
    }
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
    const result = await searchProductsByImage(
      {
        imageUrl: body.imageUrl,
        imageBase64: body.imageBase64,
      },
      {
        accessToken,
        pageSize: 12,
      },
    );
    return json(result);
  } catch (err) {
    return error(
      `Image search failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
