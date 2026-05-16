import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getActiveTokenForUser } from "@/lib/services/aliexpress-api.service";
import {
  runDailyTrendingFetch,
  todayInPkt,
} from "@/lib/services/daily-trending.service";
import { getDailyTrendingAccess } from "@/lib/services/daily-trending-access";

/**
 * /api/cron/daily-trending
 *
 * Runs daily at 5 AM PKT (0 0 * * * UTC = midnight UTC = 5 AM PKT).
 *
 * Two entry points:
 *   • GET with `Authorization: Bearer <CRON_SECRET>`
 *       → Vercel cron call. Auth via the shared cron secret.
 *   • POST with logged-in CEO session
 *       → Manual "Refresh now" trigger from the page header.
 *         Useful for first-day testing and same-day re-fetches.
 *
 * Both paths borrow the CEO's stored AE access token. If the CEO
 * hasn't connected AE, the run is short-circuited with a clear error
 * — no point hitting AE without a session.
 *
 * Cost: ~30 AE calls per run (one per distinct active niche).
 * No Claude calls. Zero per-run cost in $.
 */

export const dynamic = "force-dynamic";
// Worst case: 50 niches × ~1.5s/call = 75s. Bumped to 300s for safety.
export const maxDuration = 300;

async function runWithCeoToken() {
  const ceoUser = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (!ceoUser) {
    return { ok: false as const, status: 500, message: "No CEO user found" };
  }

  const accessToken = await getActiveTokenForUser(ceoUser.id);
  if (!accessToken) {
    return {
      ok: false as const,
      status: 503,
      message:
        "AliExpress not connected. Connect on /seo-autopilot/product-hunter first.",
    };
  }

  const result = await runDailyTrendingFetch({ accessToken });
  return { ok: true as const, result };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return error("Unauthorized", 401);
  }

  const out = await runWithCeoToken();
  if (!out.ok) return error(out.message, out.status);
  return json({ ok: true, ...out.result });
}

export async function POST() {
  // Manual trigger — CEO-only. Lets Wasif click "Refresh now" on the
  // page header to re-run the cron without waiting for tomorrow.
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const access = await getDailyTrendingAccess({
    id: session.user.id,
    role: session.user.role,
    employeeId: session.user.employeeId ?? null,
  });
  if (!access.isCeo) {
    return error("Only the CEO can trigger a manual refresh", 403);
  }

  // Wipe today's UNCLAIMED rows before re-fetching. This makes the
  // refresh feel like a clean re-run — any newly-tightened filters
  // (Etsy-friendliness, rating, etc.) apply against an empty bucket
  // instead of being silently no-op'd by the 7-day dedupe checking
  // against existing today rows.
  //
  // Claimed rows are PRESERVED so the seller doesn't lose their
  // "I'm listing this" marker when CEO refreshes.
  const wiped = await prisma.dailyTrendingProduct.deleteMany({
    where: {
      fetchDate: todayInPkt(),
      claimedById: null,
    },
  });

  const out = await runWithCeoToken();
  if (!out.ok) return error(out.message, out.status);
  return json({ ok: true, wipedBeforeRefresh: wiped.count, ...out.result });
}
