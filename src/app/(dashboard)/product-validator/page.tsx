import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProductValidatorView } from "@/components/product-validator/product-validator-view";
import { ProductValidatorComingSoon } from "@/components/product-validator/product-validator-coming-soon";
import { ProductValidatorHero } from "@/components/product-validator/product-validator-hero";
import { getProductValidatorAccess } from "@/lib/services/product-validator-access";

export const dynamic = "force-dynamic";

/**
 * /product-validator — Etsy policy pre-listing safety check.
 *
 * Seller pastes an aliexpress.com URL (regional storefronts like .us
 * are rejected; sellers switch their AE region to Pakistan to access
 * the .com link). The tool fetches the product, runs the title against
 * the encoded Etsy policy rules (Prohibited Items, IP, PPE, Creativity
 * Standards), and returns one of three verdicts:
 *
 *   - Cleared for listing  — no flags, list as-is
 *   - Listable with care   — soft flags; AI generates listing guidance
 *                            + photo-regen coaching
 *   - Cannot be listed     — hard category ban; no reframe possible
 *
 * Goal: prevent Etsy shop strikes by catching policy-violating
 * sourcing decisions BEFORE the listing goes live.
 *
 * Access: CEO-ONLY (Aug 6 2026 CEO directive — see
 * getProductValidatorAccess). Everyone else sees Coming Soon.
 */
export default async function ProductValidatorPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const access = await getProductValidatorAccess({
    id: user.id,
    role: user.role,
    employeeId: user.employeeId ?? null,
  });

  if (access.canUseRealTool) {
    // Full-bleed hero + constrained content column — same layout as
    // the Price Calculator and Product Hunter pages so the four Etsy
    // Tools all look like one product family.
    return (
      <div className="relative pb-12">
        <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
          <ProductValidatorHero />
        </div>
        <div className="max-w-5xl mx-auto">
          <ProductValidatorView />
        </div>
      </div>
    );
  }

  return <ProductValidatorComingSoon />;
}
