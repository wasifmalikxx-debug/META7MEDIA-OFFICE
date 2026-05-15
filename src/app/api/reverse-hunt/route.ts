import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { getActiveTokenForUser } from "@/lib/services/aliexpress-api.service";
import { reverseHunt } from "@/lib/services/reverse-hunt.service";

/**
 * POST /api/reverse-hunt
 *
 * Play 2: Paste an AliExpress URL or product ID → get an Etsy demand
 * verdict + projected margin in ~5 seconds.
 *
 * Access: CEO-only during pilot. Non-CEO SEO Autopilot users see a
 * Coming Soon page at /reverse-hunt — they shouldn't be able to call
 * this endpoint either. Will broaden once Wasif validates verdicts.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  input: z.string().min(8).max(500),
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
      "AliExpress not connected — connect via /seo-autopilot/product-hunter first",
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
