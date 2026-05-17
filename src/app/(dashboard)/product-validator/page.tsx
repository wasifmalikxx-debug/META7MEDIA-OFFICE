import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProductValidatorView } from "@/components/product-validator/product-validator-view";
import { ProductValidatorComingSoon } from "@/components/product-validator/product-validator-coming-soon";
import { getProductValidatorAccess } from "@/lib/services/product-validator-access";

export const dynamic = "force-dynamic";

/**
 * /product-validator — Etsy policy pre-listing safety check.
 *
 * Seller pastes an AliExpress URL (.com or .us). The tool fetches the
 * product, runs the title against ~30 encoded Etsy policy rules
 * (Prohibited Items, IP, PPE, Creativity Standards), and returns a
 * verdict: SAFE / REVIEW / BLOCKED with per-rule citations.
 *
 * Goal: prevent Etsy shop strikes by catching policy-violating
 * sourcing decisions BEFORE the listing goes live.
 *
 * Access: every Etsy team member (see getProductValidatorAccess).
 * HR / Facebook / Zain see a Coming Soon placeholder.
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
    return <ProductValidatorView />;
  }

  return <ProductValidatorComingSoon />;
}
