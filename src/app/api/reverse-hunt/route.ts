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

// Bumped max from 500 → 2000 chars on May 16 2026 — real AE URLs with
// affiliate tracking / click IDs / session params / btsid / aem_p4p
// routinely exceed 500 chars. We only use the URL to extract the
// product ID via regex, so the rest is ignored. 2000 is comfortable
// headroom for even the most decorated tracking URLs.
//
// Added manualProduct on May 17 2026 — for aliexpress.us URLs where
// both the DS API and HTML scrape fail (Cloudflare / JS-only render).
// User can paste title + price by hand and still get the verdict.
const RequestSchema = z
  .object({
    input: z.string().min(8).max(2000).optional(),
    manualProduct: z
      .object({
        title: z.string().min(3).max(300),
        priceUsd: z.number().positive().max(10000),
        imageUrl: z.string().max(1000).optional().nullable(),
        productUrl: z.string().max(2000).optional().nullable(),
      })
      .optional(),
  })
  .refine((data) => Boolean(data.input || data.manualProduct), {
    message: "Either an AE URL/ID or manual product info is required",
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
    if (err instanceof z.ZodError) {
      // Friendly translation of the Zod issue array — beats showing
      // the raw "[ { 'origin': 'string', 'code': 'too_big', ... } ]"
      // JSON in a toast.
      const issue = err.issues[0];
      const friendly =
        issue?.code === "too_big"
          ? "URL is too long — try copying the URL without affiliate parameters, or just the product ID."
          : issue?.code === "too_small"
            ? "Please paste a full AliExpress URL or product ID."
            : issue?.message ?? "Invalid input";
      return error(friendly, 400);
    }
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // Manual mode doesn't need an AE token (we skip the DS API call
  // entirely). URL mode does need it for the DS API + the scrape
  // fallback's Etsy keyword extraction would still benefit from it.
  const accessToken = await getActiveTokenForUser(session.user.id);
  if (!accessToken && !body.manualProduct) {
    return error(
      "AliExpress not connected — connect via /seo-autopilot/product-hunter first",
      409,
    );
  }

  try {
    const result = await reverseHunt(
      {
        input: body.input,
        manualProduct: body.manualProduct ?? undefined,
      },
      accessToken ?? "",
    );
    return json(result);
  } catch (err) {
    return error(
      `Reverse hunt failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
