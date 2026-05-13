import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { searchTaxonomyNodes, getTaxonomyPath } from "@/lib/services/etsy-api.service";

/**
 * GET /api/seo-autopilot/categories?q=earrings
 *
 * Fuzzy-search Etsy's seller taxonomy. Backs the category combobox in the
 * Autopilot UI. SUPER_ADMIN only (same gate as the generator).
 *
 * Returns up to 12 matches, leaf-first, with a resolved breadcrumb path
 * so the CEO can pick the exact node without guessing.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  if (session.user.role !== "SUPER_ADMIN") {
    return error("Forbidden", 403);
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return json({ results: [] });
  }

  try {
    const matches = await searchTaxonomyNodes(q, 12);
    // Resolve paths concurrently — they all hit the same in-memory
    // taxonomy cache, so this is cheap after the first call.
    const results = await Promise.all(
      matches.map(async (n) => ({
        id: n.id,
        name: n.name,
        level: n.level,
        path: await getTaxonomyPath(n.id),
      })),
    );
    return json({ results });
  } catch (err) {
    return error(
      `Taxonomy lookup failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }
}
