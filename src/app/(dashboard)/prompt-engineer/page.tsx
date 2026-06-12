import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PromptEngineerView } from "@/components/prompt-engineer/prompt-engineer-view";
import { PromptEngineerComingSoon } from "@/components/prompt-engineer/prompt-engineer-coming-soon";

export const dynamic = "force-dynamic";

/**
 * /prompt-engineer — AliExpress photo → Higgsfield image-gen prompt.
 *
 * Access policy (CEO directive 2026-06-12):
 *  - SUPER_ADMIN (Wasif) → real tool
 *  - Everyone else        → Coming Soon placeholder
 *
 * CEO-only while prompt quality is validated, then rolled out to the
 * Etsy team (same staged pattern Product Hunter used). The API route
 * (/api/prompt-engineer/generate) enforces the same SUPER_ADMIN gate
 * server-side so a stale bundle can't reach it.
 */
export default async function PromptEngineerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isCeo = session.user.role === "SUPER_ADMIN";

  if (!isCeo) {
    return (
      <div className="relative pb-12">
        <PromptEngineerComingSoon />
      </div>
    );
  }

  return (
    <div className="relative pb-12">
      <PromptEngineerView />
    </div>
  );
}
