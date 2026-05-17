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
 * Body: { url?: string, manualTitle?: string, manualImageUrl?: string }
 *   - Pass `url` for auto-fetch (works for .com URLs, often for .us
 *     via HTML scrape fallback).
 *   - Pass `manualTitle` (+ optional manualImageUrl) when auto-fetch
 *     fails or the user has the title in hand already.
 *
 * Returns: { verdict, summary, flags, product, fetchPath, durationMs }
 *
 * Access: all Etsy team members (see getProductValidatorAccess).
 * AE token is borrowed from the CEO's connection for the DS API call.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z
  .object({
    url: z.string().min(8).max(2000).optional(),
    manualTitle: z.string().min(3).max(500).optional(),
    manualImageUrl: z.string().max(1000).optional().nullable(),
  })
  .refine((d) => Boolean(d.url || d.manualTitle), {
    message: "Either a product URL or a manual title is required",
  });

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
        manualImageUrl: body.manualImageUrl ?? undefined,
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
