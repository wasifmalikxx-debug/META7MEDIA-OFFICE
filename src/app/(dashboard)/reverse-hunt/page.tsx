import { redirect } from "next/navigation";

/**
 * /reverse-hunt is now a permanent redirect to the unified Product
 * Hunter hub. All hunting tools (Niche Hunter, Reverse Hunt, Image
 * Hunt, etc.) live on one page now — May 16 2026 consolidation.
 *
 * Old bookmarks continue to work; users land on the Reverse Hunt
 * tab inside Product Hunter.
 */
export default function ReverseHuntRedirect() {
  redirect("/seo-autopilot/product-hunter?tab=reverse");
}
