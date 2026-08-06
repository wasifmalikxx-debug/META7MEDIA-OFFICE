import { NextRequest } from "next/server";
import { z } from "zod";
import { sanitizeMaybePromptInput } from "@/lib/prompt-safety";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getActiveTokenForUser } from "@/lib/services/aliexpress-api.service";
import { validateProduct } from "@/lib/services/product-validator.service";
import { getProductValidatorAccess } from "@/lib/services/product-validator-access";

/**
 * POST /api/product-validator
 *
 * Body: { url?: string, manualTitle?: string }
 *   - Pass `url` for auto-fetch. Only aliexpress.com URLs are accepted.
 *     Regional storefronts (.us / .ru / .de etc.) are rejected — sellers
 *     must switch their AliExpress region to Pakistan to get .com links.
 *   - Pass `manualTitle` when the seller has the title in hand and is
 *     uploading reference photos locally.
 *
 * Returns: { verdict, summary, flags, product, fetchPath, durationMs }
 *
 * Access: CEO only (see getProductValidatorAccess) — locked Aug 6 2026.
 * AE token is borrowed from the CEO's connection for the DS API call.
 */

export const dynamic = "force-dynamic";
// Reframe adds one Haiku call (~3-5s). 30s is plenty.
export const maxDuration = 30;

// 800K chars of base64 ≈ 600KB raw per image. The SeoImageUploader
// resizes to 768px / JPEG 0.85 so real-world uploads are 150-400KB —
// the cap leaves plenty of headroom. Earlier cap was 3M chars which
// allowed total payloads (2 images + JSON) to exceed Vercel's 4.5MB
// serverless body limit; requests would be rejected by the platform
// with a 413 before our handler ran, and the user saw a generic
// failure with no log trail.
const ManualImageSchema = z.object({
  base64: z.string().min(100).max(800_000),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

const RequestSchema = z
  .object({
    url: z.string().min(8).max(2000).optional(),
    manualTitle: z.string().min(3).max(500).optional().transform((v) => sanitizeMaybePromptInput(v, 500)),
    /** Up to 2 base64-encoded photos from Manual check uploader. */
    manualImages: z.array(ManualImageSchema).max(2).optional(),
  })
  .refine((d) => Boolean(d.url || d.manualTitle), {
    message: "Either a product URL or a manual title is required",
  })
  .refine(
    (d) => {
      if (!d.url) return true;
      const u = d.url.trim();
      // Pure numeric product IDs are accepted.
      if (/^\d+$/.test(u)) return true;
      // Reject any regional AliExpress storefront — must be .com.
      if (/aliexpress\.(us|ru|fr|de|es|it|pl|nl|co\.kr|co\.jp)/i.test(u)) {
        return false;
      }
      return /aliexpress\.com/i.test(u);
    },
    {
      message:
        "Only aliexpress.com URLs are accepted. On AliExpress, change the shipping region from United States to Pakistan to view the same product on the .com storefront.",
    },
  );

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getProductValidatorAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) return error("Forbidden", 403);

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      const friendly =
        issue?.code === "too_big"
          ? "URL is too long — copy the URL without affiliate parameters or use manual entry."
          : issue?.code === "too_small"
            ? "Paste a full AliExpress URL or provide manual title."
            : issue?.message ?? "Invalid input";
      return error(friendly, 400);
    }
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // Borrow the CEO's AE token for the DS API call. Manual mode doesn't
  // need it — we go straight to rule matching with the supplied title.
  // If accessToken is still undefined when the service runs the URL
  // path, the service throws "AliExpress connection is not available"
  // and the route surfaces it as a 502.
  let accessToken: string | undefined;
  if (!body.manualTitle) {
    const ceoUser = await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN" },
      select: { id: true },
    });
    if (ceoUser) {
      accessToken = (await getActiveTokenForUser(ceoUser.id)) ?? undefined;
    }
  }

  try {
    const result = await validateProduct(
      {
        url: body.url,
        manualTitle: body.manualTitle,
        manualImages: body.manualImages,
      },
      { accessToken },
    );
    return json(result);
  } catch (err) {
    return error(
      err instanceof Error ? err.message : "Validation failed",
      502,
    );
  }
}
