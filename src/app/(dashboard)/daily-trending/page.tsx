import { redirect } from "next/navigation";

/**
 * /daily-trending — legacy URL.
 *
 * Daily Trending moved INSIDE the Product Hunter hub as a tab on
 * May 16 2026 (CEO-only validation phase). This page now redirects
 * any bookmarks / shared links to the new home so nothing 404s.
 *
 * Old standalone components (DailyTrendingView + DailyTrendingComingSoon)
 * still exist and are imported by ProductHunterView — only the
 * standalone URL is retired.
 */
export const dynamic = "force-dynamic";

export default function DailyTrendingLegacyPage() {
  redirect("/seo-autopilot/product-hunter?tab=trending");
}
