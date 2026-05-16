import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { huntByNiche } from "@/lib/services/product-hunter.service";
import { getActiveTokenForUser } from "@/lib/services/aliexpress-api.service";
import { getSeoAutopilotAccess } from "@/lib/services/seo-autopilot-access";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/seo-autopilot/hunt-by-niche
 *
 * The new Manual Hunting pipeline (May 16 2026 redesign).
 *
 * Input:
 *   - niche (required)             e.g. "boho jewelry"
 *   - style (optional pill)        e.g. "minimalist"
 *   - audience (optional pill)     e.g. "anniversary gift"
 *   - extraCategories (optional)   employee's shop categories to force-include
 *
 * Pipeline:
 *   1. Claude → niche → 5-8 shop categories
 *   2. Per category (parallel) → Claude → 4-6 keywords
 *   3. Per keyword (parallel) → Etsy demand + score
 *   4. Per GREAT/GOOD keyword → AliExpress top-3 preview + margin
 *
 * Returns the results organized by category.
 *
 * Access (May 16 2026 — EM-team rollout): anyone with
 * canUseRealTool from the shared SEO Autopilot predicate. That's
 * CEO + Etsy partners + Izaan (EM-4) + EM employees. AE side
 * always uses the CEO's stored token regardless of caller.
 */

export const dynamic = "force-dynamic";
// v2.2 pipeline ran ~56s on the first prod test, which was too close to
// the 60s cap. Bumped to 300s (Vercel Pro max) so network latency spikes
// don't push us over. Actual typical wall time is still 30-45s.
export const maxDuration = 300;

const RequestSchema = z.object({
  niche: z.string().min(2, "Niche must be at least 2 chars").max(80),
  style: z.string().max(40).optional().nullable(),
  audience: z.string().max(40).optional().nullable(),
  extraCategories: z.array(z.string().min(2).max(40)).max(10).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  // Same role gate as the page. Anyone with canUseRealTool can hunt:
  // CEO + Etsy partners + Izaan + EM employees. Backend-side check
  // mirrors the UI so a stale bundle can't bypass the gate.
  const access = await getSeoAutopilotAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.canUseRealTool) {
    return error(
      "Manual Hunting access is not enabled for your account",
      403,
    );
  }

  let payload: z.infer<typeof RequestSchema>;
  try {
    payload = RequestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      const friendly = err.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join(" · ");
      return error(friendly, 400);
    }
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  // CEO's AliExpress token powers the AE preview step.
  // If not connected, the pipeline still runs but skips AE previews —
  // employee sees a banner with reconnect instructions on the page itself.
  const ceoUser = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  const accessToken = ceoUser
    ? await getActiveTokenForUser(ceoUser.id)
    : null;

  try {
    const result = await huntByNiche({
      niche: payload.niche,
      style: payload.style ?? undefined,
      audience: payload.audience ?? undefined,
      extraCategories: payload.extraCategories,
      accessToken,
    });
    return json(result);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    console.error(`[hunt-by-niche] failed:`, reason);
    return error(`Hunt failed: ${reason}`, 502);
  }
}
