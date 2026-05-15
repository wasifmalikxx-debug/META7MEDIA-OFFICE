import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { scanOpportunities } from "@/lib/services/opportunity-scanner.service";

/**
 * POST /api/seo-autopilot/scan-opportunities
 *
 * CEO-only (SUPER_ADMIN). Takes a seed keyword and returns 25-30
 * scored Etsy-niche opportunities — ranked by composite score
 * (demand + engagement + shop diversity + long-tail bonus).
 *
 * Used by /seo-autopilot/opportunities so Wasif can find underserved
 * niches before sending the team to hunt AliExpress for matching
 * products.
 *
 * Cost: ~$0.005 in Haiku + ~25 Etsy calls (free, ~7s wall time at
 * the shared 3.3 QPS bucket).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 25 parallel Etsy calls at 3.3 QPS

const RequestSchema = z.object({
  seedKeyword: z.string().min(2, "Need at least 2 chars").max(80),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") {
    return error(
      "Forbidden — Opportunity Scanner is CEO-only during testing",
      403,
    );
  }

  let payload: z.infer<typeof RequestSchema>;
  try {
    const body = await request.json();
    payload = RequestSchema.parse(body);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Invalid payload", 400);
  }

  try {
    const result = await scanOpportunities(payload.seedKeyword);
    return json(result);
  } catch (err) {
    return error(
      `Scan failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
