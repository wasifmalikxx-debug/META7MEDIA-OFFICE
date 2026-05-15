import { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, requireAuth } from "@/lib/api-helpers";
import {
  getActiveTokenForUser,
  searchProductsByKeyword,
} from "@/lib/services/aliexpress-api.service";

/**
 * POST /api/aliexpress/products-for-keyword
 *
 * Play 1: Full-loop Product Hunter. Given a keyword that scored well
 * in the Etsy-side scan, returns the top matching AliExpress products
 * so the team has an instant shopping list to evaluate.
 *
 * CEO-only during the pilot (matches Product Hunter's role gate).
 *
 * Body: { keyword: string, limit?: number }
 * Returns: { totalResults, products: AliExpressProduct[] }
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  keyword: z.string().min(2).max(120),
  limit: z.number().int().min(1).max(30).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") {
    return error("CEO-only during pilot", 403);
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
      "AliExpress not connected — visit /api/aliexpress/auth-start first",
      409,
    );
  }

  try {
    console.log(
      `[aliexpress] products-for-keyword: searching "${body.keyword}" (limit ${body.limit ?? 10})`,
    );
    const result = await searchProductsByKeyword(body.keyword, {
      accessToken,
      pageSize: body.limit ?? 10,
      sortBy: "orders_desc",
    });
    console.log(
      `[aliexpress] products-for-keyword: got ${result.products.length} products (totalResults=${result.totalResults})`,
    );
    return json(result);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[aliexpress] products-for-keyword FAILED:`, reason);
    return error(`AliExpress search failed: ${reason}`, 502);
  }
}
