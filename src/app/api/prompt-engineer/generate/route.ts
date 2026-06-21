import { NextRequest } from "next/server";
import { z } from "zod";
import { sanitizeMaybePromptInput } from "@/lib/prompt-safety";
import { json, error, requireRole } from "@/lib/api-helpers";
import {
  generateHiggsfieldPrompt,
  createCostAccumulator,
} from "@/lib/services/anthropic.service";

/**
 * POST /api/prompt-engineer/generate
 *
 * CEO-ONLY (SUPER_ADMIN) while the tool is validated. Everyone else
 * sees the Coming Soon placeholder and never reaches this route — but
 * we still hard-gate server-side so a stale bundle can't call it.
 *
 * Takes one AliExpress product photo + options and returns a
 * Higgsfield text-to-image prompt that keeps the product identical,
 * swaps in a USA/Western model, and changes the pose. Pass the
 * returned `modelPersona` back on subsequent images of the same
 * listing to keep the model consistent across all 7-8 shots.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestSchema = z.object({
  image: z.object({
    base64: z.string().min(100),
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  }),
  modelType: z.enum(["woman", "man", "girl", "boy", "kid"]),
  background: z.string().max(120).optional().nullable().transform((v) => sanitizeMaybePromptInput(v, 120)),
  style: z.string().max(120).optional().nullable().transform((v) => sanitizeMaybePromptInput(v, 120)),
  pose: z.string().max(200).optional().nullable().transform((v) => sanitizeMaybePromptInput(v, 200)),
  orientation: z.string().max(40).optional().nullable().transform((v) => sanitizeMaybePromptInput(v, 40)),
  freeText: z.string().max(800).optional().nullable().transform((v) => sanitizeMaybePromptInput(v, 800)),
  modelPersona: z.string().max(2000).optional().nullable().transform((v) => sanitizeMaybePromptInput(v, 2000)),
});

export async function POST(request: NextRequest) {
  // CEO-only gate. requireRole returns null if not SUPER_ADMIN.
  const session = await requireRole("SUPER_ADMIN");
  if (!session) {
    return error("Prompt Engineer is not available for your account yet.", 403);
  }

  let payload: z.infer<typeof RequestSchema>;
  try {
    payload = RequestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      const friendly = err.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join(" · ");
      return error(friendly, 400);
    }
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  const costAccum = createCostAccumulator();

  try {
    const result = await generateHiggsfieldPrompt(
      {
        image: payload.image,
        modelType: payload.modelType,
        background: payload.background ?? undefined,
        style: payload.style ?? undefined,
        pose: payload.pose ?? undefined,
        orientation: payload.orientation ?? undefined,
        freeText: payload.freeText ?? undefined,
        modelPersona: payload.modelPersona ?? undefined,
      },
      costAccum,
    );

    return json({
      ...result,
      costUsd: Number(costAccum.totalCostUsd.toFixed(6)),
    });
  } catch (err) {
    return error(
      `Couldn't generate the prompt: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
