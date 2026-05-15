import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { huntProducts } from "@/lib/services/product-hunter.service";
import {
  getActiveTokenForUser,
  searchProductsByKeyword,
} from "@/lib/services/aliexpress-api.service";
import { calculateEtsyPrice } from "@/lib/etsy-price-calculator";
import { notifyAdmin } from "@/lib/services/whatsapp.service";

/**
 * GET /api/cron/daily-hunt
 *
 * Play 3 — Daily Auto-Hunt.
 *
 * Runs at 6 AM PKT (1am UTC). For each seed category:
 *   1. Run Product Hunter on the seed (Haiku brainstorm + Etsy scoring)
 *   2. Take the top 3 GREAT/GOOD keywords
 *   3. For each, fetch top 5 AliExpress products
 *   4. Score margin per AliExpress product
 *   5. Pick the single best "winner" per seed
 *
 * Result: WhatsApp summary to CEO listing today's top sourcing ideas.
 *
 * Seed categories configurable via env DAILY_HUNT_SEEDS (comma-separated).
 * Falls back to a sensible starter list.
 *
 * Cost guardrails: max 5 seeds × ~25 Etsy + 3 AliExpress = ~140 API calls
 * across both providers. Well under either daily cap.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 seeds × ~30s each = potentially 150s

const DEFAULT_SEEDS = [
  "jewelry",
  "home decor",
  "wall art",
  "phone case",
  "candle",
];

interface SeedSummary {
  seed: string;
  topPick: {
    keyword: string;
    verdict: string;
    score: number;
    aliTitle: string;
    aliPrice: number;
    etsyPrice: number;
    margin: number;
  } | null;
  error?: string;
}

export async function GET(request: NextRequest) {
  // Cron auth
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return error("Unauthorized", 401);
  }

  // CEO token
  const ceoUser = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (!ceoUser) return error("No CEO user found", 500);

  const accessToken = await getActiveTokenForUser(ceoUser.id);
  if (!accessToken) {
    // No token — send a gentle reminder instead of running scans
    await notifyAdmin(
      "Daily Auto-Hunt skipped — AliExpress isn't connected. Visit portal.meta7.media/seo-autopilot/product-hunter to reconnect.",
    );
    return json({ ok: true, skipped: "no_token" });
  }

  const seeds =
    process.env.DAILY_HUNT_SEEDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? DEFAULT_SEEDS;

  const summaries: SeedSummary[] = [];

  // Sequential — keeps us under Etsy + AliExpress rate limits comfortably,
  // and 5 seeds × ~25s = ~125s wall time which fits the cron's 300s budget.
  for (const seed of seeds.slice(0, 5)) {
    try {
      const hunt = await huntProducts(seed);
      const candidates = hunt.results
        .filter((r) => r.verdict === "GREAT" || r.verdict === "GOOD")
        .slice(0, 3);

      if (candidates.length === 0) {
        summaries.push({ seed, topPick: null });
        continue;
      }

      // For each candidate keyword, ask AliExpress for top 5 products
      let bestPick: SeedSummary["topPick"] = null;

      for (const cand of candidates) {
        try {
          const ali = await searchProductsByKeyword(cand.keyword, {
            accessToken,
            pageSize: 5,
            sortBy: "orders_desc",
          });
          for (const p of ali.products.slice(0, 3)) {
            if (!p.priceMin) continue;
            const pricing = calculateEtsyPrice(p.priceMin);
            const margin = pricing.markup;
            if (margin < 5) continue; // skip thin
            if (!bestPick || margin > bestPick.margin) {
              bestPick = {
                keyword: cand.keyword,
                verdict: cand.verdict,
                score: cand.score,
                aliTitle: p.title.slice(0, 80),
                aliPrice: p.priceMin,
                etsyPrice: pricing.etsyMatured,
                margin,
              };
            }
          }
        } catch {
          // Skip this candidate, keep going
        }
      }

      summaries.push({ seed, topPick: bestPick });
    } catch (err) {
      summaries.push({
        seed,
        topPick: null,
        error: err instanceof Error ? err.message : "scan_failed",
      });
    }
  }

  // Build WhatsApp summary message. Meta WhatsApp rejects newlines in template
  // params but free-text messages from a verified business number are fine.
  // notifyAdmin uses free-text, so multi-line is OK here.
  const wins = summaries.filter((s) => s.topPick);
  let message: string;
  if (wins.length === 0) {
    message =
      "Daily Auto-Hunt: no winners today. Either every seed is saturated or the margin filter caught everything. Try adjusting seeds in DAILY_HUNT_SEEDS env var.";
  } else {
    const lines = [
      `Daily Auto-Hunt — ${wins.length} winner${wins.length === 1 ? "" : "s"} today:`,
      "",
    ];
    for (const w of wins) {
      if (!w.topPick) continue;
      const p = w.topPick;
      lines.push(
        `${w.seed.toUpperCase()} → "${p.keyword}" (${p.verdict}, ${p.score}/100)`,
      );
      lines.push(
        `  ${p.aliTitle.slice(0, 60)} — $${p.aliPrice.toFixed(2)} → Etsy $${p.etsyPrice.toFixed(2)} (margin $${p.margin.toFixed(2)})`,
      );
      lines.push("");
    }
    lines.push(
      "Open Product Hunter on the portal to see full details + sourcing links.",
    );
    message = lines.join("\n");
  }

  try {
    await notifyAdmin(message);
  } catch (err) {
    console.error("[daily-hunt] WhatsApp notify failed:", err);
  }

  return json({
    ok: true,
    seedsScanned: summaries.length,
    winners: wins.length,
    summaries,
  });
}
