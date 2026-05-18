import { NextRequest } from "next/server";
import { z } from "zod";
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
 * Access: all Etsy team members (see getProductValidatorAccess).
 * AE token is borrowed from the CEO's connection for the DS API call.
 */

export const dynamic = "force-dynamic";
// Reframe adds one Haiku call (~3-5s). 30s is plenty.
export const maxDuration = 30;

const ManualImageSchema = z.object({
  base64: z.string().min(100).max(3_000_000), // ~2.2 MB max after b64 expansion
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

const RequestSchema = z
  .object({
    url: z.string().min(8).max(2000).optional(),
    manualTitle: z.string().min(3).max(500).optional(),
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
  let accessToken: string | undefined;
  if (!body.manualTitle) {
    const ceoUser = await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN" },
      select: { id: true },
    });
    if (ceoUser) {
      accessToken = (await getActiveTokenForUser(ceoUser.id)) ?? undefined;
    }
    // If accessToken is still undefined, the service will fall back to
    // the HTML scrape path (which works for many .com URLs too). No
    // need to hard-fail — the worst case is "couldn't auto-load, try
    // manual entry."
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
